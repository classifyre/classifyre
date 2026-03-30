import { Module, Global } from '@nestjs/common';
import { RunnerEventsGateway } from './runner-events.gateway';
import { NotificationEventsGateway } from './notification-events.gateway';

@Global()
@Module({
  providers: [RunnerEventsGateway, NotificationEventsGateway],
  exports: [RunnerEventsGateway, NotificationEventsGateway],
})
export class WebSocketModule {}
