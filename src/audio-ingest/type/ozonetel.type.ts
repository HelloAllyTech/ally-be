export type OzonetelCallDetailsBody = {
  data: string;
};

export type OzonetelCallDetails = {
  AgentID?: string;
  AgentName?: string;
  AgentPhoneNumber?: string;
  AgentStatus?: string;
  AgentUniqueID?: string;
  Apikey?: string;
  AudioFile?: string;
  CallDuration?: string;
  CallerConfAudioFile?: string;
  CallerID?: string;
  CampaignName?: string;
  CampaignStatus?: string;
  Comments?: string;
  ConfDuration?: string;
  CustomerStatus?: string;
  DataUniqueId?: string;
  DialStatus?: string;
  DialedNumber?: string;
  DId?: string;
  Disposition?: string;
  Duration?: string;
  EndTime?: string;
  FallBackRule?: string;
  HangupBy?: string;
  HoldDuration?: string;
  Location?: string;
  monitorUCID?: string;
  PhoneName?: string;
  Skill?: string;
  StartTime?: string;
  Status?: OzonetelCallStatus;
  TimeToAnswer?: string;
  TransferType?: string;
  TransferredTo?: string;
  Type?: string;
  UserName?: string;
  UUI?: string;
  WrapUpDuration?: string;
};

export type OzonetelCallEventData = {
  action?: string; // "Calling" | "Answered" | "Disconnect"
  call_type?: string; // "Manual" | "Inbound" | "Progressive" | "Preview" | "Predictive"
  ucid?: string;
  monitor_ucid?: string;
  agent_id?: string;
  skill?: string;
  caller_id?: string;
  did?: string;
  agent_number?: string;
  event_time?: string;
};

export type OzonetelCallEventsDto = {
  eventType?: string; // "Call" | "Agent"
  eventTime?: string;
  username?: string;
  data?: OzonetelCallEventData;
};

export enum OzonetelCallAction {
  Calling = 'Calling',
  Answered = 'Answered',
  Disconnect = 'Disconnect',
}

export enum OzonetelEventTypes {
  Call = 'Call',
  Agent = 'Agent',
}

export enum OzonetelCallStatus {
  Answered = 'Answered',
  Disconnected = 'NotAnswered',
}
