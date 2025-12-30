export abstract class MessageBroker {
  abstract publish(channel: string, message: any): Promise<void>;
  abstract subscribe(
    channel: string,
    callback: (message: any) => void,
  ): Promise<void>;
}
