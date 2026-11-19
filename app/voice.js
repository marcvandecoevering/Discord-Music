import { EventEmitter } from 'node:events';
import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } from 'discord.js';
import { createAudioPlayer, createAudioResource, NoSubscriberBehavior, StreamType, AudioPlayerStatus, joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
export class Voice extends EventEmitter {
  constructor(){
    super();this.ready=false;
    this.client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
    this.audio=createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Pause}});
    this.audio.on('error',e=>this.emit('error',Error('Discord audio error')));
    this.audio.on(AudioPlayerStatus.Idle,()=>{if(this.expectedEnd){this.expectedEnd=false;this.emit('end');}});
    this.client.on('error',()=>this.emit('error',Error('Discord connection error')));
    this.client.on('shardDisconnect',()=>{this.ready=false;this.leave();this.emit('lost');});
    this.client.on('shardResume',()=>{this.ready=true;});
  }
  get listeners(){return this.channel?.members.filter(m=>!m.user.bot).size||0;}
  get connected(){return this.connection?.state.status===VoiceConnectionStatus.Ready;}
  async connect(){
    for(const key of ['DISCORD_TOKEN','DISCORD_GUILD_ID','DISCORD_CHANNEL_ID'])if(!process.env[key])throw Error('Missing '+key);
    await this.client.login(process.env.DISCORD_TOKEN);
    if(!this.client.isReady())await new Promise(r=>this.client.once('clientReady',r));
    this.guild=await this.client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    this.channel=await this.guild.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if(this.channel?.type!==ChannelType.GuildVoice)throw Error('Choose a normal Discord voice channel');
    const me=await this.guild.members.fetchMe();
    if(!this.channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]))throw Error('Bot needs View Channel, Connect and Speak');
    this.ready=true;
    this.client.on('voiceStateUpdate',(before,after)=>{
      if(before.channelId!==this.channel.id&&after.channelId!==this.channel.id)return;
      if(!this.listeners)this.emit('empty');
      if(after.id===me.id&&after.channelId&&after.channelId!==this.channel.id){this.leave();this.emit('lost');}
    });
  }
  async join(){
    if(this.connected)return;
    const connection=this.connection=joinVoiceChannel({channelId:this.channel.id,guildId:this.guild.id,adapterCreator:this.guild.voiceAdapterCreator,selfDeaf:true,selfMute:false,daveEncryption:true});
    connection.on('error',()=>this.emit('error',Error('Discord voice connection error')));
    connection.on(VoiceConnectionStatus.Disconnected,()=>{if(this.connection===connection){this.leave();this.emit('lost');}});
    await entersState(connection,VoiceConnectionStatus.Ready,30000);
    connection.subscribe(this.audio);
  }
  play(stream,volume){this.resource=createAudioResource(stream,{inputType:StreamType.Raw,inlineVolume:true});this.resource.volume.setVolume(volume);this.expectedEnd=true;this.audio.play(this.resource);}
  stop(){this.expectedEnd=false;this.audio.stop(true);}
  volume(v){this.resource?.volume?.setVolume(v);}
  leave(){this.stop();const c=this.connection;this.connection=null;if(c&&c.state.status!==VoiceConnectionStatus.Destroyed)c.destroy();}
  close(){this.ready=false;this.leave();this.client.destroy();}
}
// Disabled mode is for migration checks and CI; it never connects to Discord.
export class DisabledVoice extends EventEmitter {
  ready=false;listeners=0;connected=false;
  async connect(){} stop(){} leave(){} close(){} volume(){}
}
