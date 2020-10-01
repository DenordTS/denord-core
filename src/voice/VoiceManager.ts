import type { Snowflake, voice } from "../discord.ts";
import type { ShardManager } from "../gateway/ShardManager.ts";
import { deferred } from "../../deps.ts";

export class VoiceManager {
  connections = new Map<Snowflake, { channelId: Snowflake; worker: Worker }>();
  #gateway: ShardManager;
  #userId: Snowflake;

  constructor(gateway: ShardManager, userId: Snowflake) {
    this.#gateway = gateway;
    this.#userId = userId;
  }

  async connect(
    shard: number,
    guildId: Snowflake,
    channelId: Snowflake,
  ): Promise<void> {
    if (this.connections.has(guildId)) {
      throw new Error(
        "You are already connected to a voice channel in this server",
      );
    }

    const promise = deferred<void>();

    const worker = new Worker(new URL("Connection.ts", import.meta.url).href, {
      type: "module",
      name: `${guildId}/${channelId}`,
      deno: true,
    });
    worker.onmessage = (msg) => {
      const event = msg.data;

      switch (event.name) {
        case "CONNECTED":
          this.connections.set(guildId, { channelId, worker });
          promise.resolve();
          break;
      }
    };

    const stateListener = (state: voice.State) => {
      if (
        state.guild_id === guildId &&
        state.channel_id === channelId &&
        state.user_id === this.#userId
      ) {
        this.#gateway.off("VOICE_STATE_UPDATE", stateListener);

        const serverListener = (server: voice.ServerUpdateEvent) => {
          if (server.guild_id === guildId) {
            this.#gateway.off("VOICE_SERVER_UPDATE", serverListener);

            worker.postMessage({
              name: "INIT",
              data: {
                guildId,
                userId: this.#userId,
                sessionId: state.session_id,
                token: server.token,
                ip: server.endpoint,
              },
            });
          }
        };

        this.#gateway.on("VOICE_SERVER_UPDATE", serverListener);
      }
    };
    this.#gateway.on("VOICE_STATE_UPDATE", stateListener);
    this.#gateway.voice(shard, guildId, channelId);

    return promise;
  }

  async disconnect(guildId: Snowflake, channelId: Snowflake): Promise<void> {
    if (!this.connections.has(guildId)) {
      throw new Error(
        "You are not connected to a voice channel in this server",
      );
    }

    const connection = this.connections.get(guildId)!;

    if (connection.channelId !== channelId) {
      throw new Error("You are not connected to this voice channel");
    }

    const promise = awaitWorkerMessage(connection.worker, "DISCONNECTED");
    connection.worker.postMessage({
      name: "DISCONNECT",
    });
    await promise;
    this.connections.delete(guildId);
  }

  async speak(
    guildId: Snowflake,
    voiceData: ReadableStream<Uint8Array> | Uint8Array,
    priority = false,
  ): Promise<void> {
    const connection = this.connections.get(guildId);

    if (!connection) {
      throw new Error("You need to be connected to a voice channel to be able speak");
    }

    connection.worker.postMessage({
      name: "START_SPEAK",
      data: priority,
    });

    const audioPromise = awaitWorkerMessage(connection.worker, "SENT_AUDIO");

    if (voiceData instanceof ReadableStream) {
      for await (const data of voiceData.getIterator()) {
        connection.worker.postMessage({
          name: "SEND_AUDIO",
          data: data,
        });
      }
    } else {
      connection.worker.postMessage({
        name: "SEND_AUDIO",
        data: voiceData,
      });
    }

    await audioPromise;

    connection.worker.postMessage({
      name: "STOP_SPEAK",
    });
  }
}

function awaitWorkerMessage(worker: Worker, name: string): Promise<void> {
  const promise = deferred<void>();
  const listener = (msg: Event) => {
    if ((msg as any).data.name === name) {
      worker.removeEventListener("message", listener);
      promise.resolve();
    }
  }
  worker.addEventListener("message", listener);
  return promise;
}
