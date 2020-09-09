import type { Client } from "../Client.ts";
import type { channel, Snowflake } from "../discord.ts";
import {
  GuildChannel,
  PermissionOverwrite,
  unparsePermissionOverwrite,
} from "./GuildChannel.ts";
import { parseInvite } from "./Invite.ts";

export class VoiceChannel<T extends channel.VoiceChannel = channel.VoiceChannel> extends GuildChannel<T> {
  type = "voice";
  bitrate: number;
  userLimit: number;

  constructor(client: Client, data: T) {
    super(client, data);

    this.bitrate = data.bitrate;
    this.userLimit = data.user_limit;
  }

  async edit(options: {
    name?: string;
    position?: number | null;
    bitrate?: number | null;
    userLimit?: number | null;
    permissionOverwrites?: PermissionOverwrite[] | null;
    parentId: Snowflake | null;
  }, reason?: string) {
    const permissionOverwrites =
      options.permissionOverwrites?.map(({ permissions, id, type }) => {
        const { allow, deny } = unparsePermissionOverwrite(permissions);

        return {
          id,
          type,
          allow,
          deny,
        };
      }) ?? (options.permissionOverwrites as undefined | null);

    const channel = await this.client.rest.modifyChannel(this.id, {
      name: options.name,
      position: options.position,
      bitrate: options.bitrate,
      user_limit: options.userLimit,
      permission_overwrites: permissionOverwrites,
      parent_id: options.parentId,
    }, reason);

    return new VoiceChannel(this.client, channel as channel.VoiceChannel);
  }

  async delete(reason?: string) {
    const channel = await this.client.rest.deleteChannel(
      this.id,
      reason,
    ) as channel.VoiceChannel;
    return new VoiceChannel(this.client, channel);
  }

  async getInvites() {
    const invites = await this.client.rest.getChannelInvites(this.id);

    return invites.map((invite) => parseInvite(this.client, invite));
  }
}
