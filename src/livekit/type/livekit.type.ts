import { EncodedFileType } from 'livekit-server-sdk';

export interface StartRoomCompositeEgressParams {
  filepath: string;
  roomName: string;
  bucket: string;
  region: string;
  accessKey: string;
  secret: string;
  audioOnly?: boolean;
  fileType?: EncodedFileType;
}

export interface BuildS3FileOutputParams {
  filepath: string;
  bucket: string;
  region: string;
  accessKey: string;
  secret: string;
  fileType?: EncodedFileType;
}
