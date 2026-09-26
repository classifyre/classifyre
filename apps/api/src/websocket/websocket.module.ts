import { Module, Global } from '@nestjs/common';
import { RunnerEventsGateway } from './runner-events.gateway';
import { NotificationEventsGateway } from './notification-events.gateway';
import { CaseBoardGateway } from './case-board.gateway';
import { CASE_BOARD_EVENTS } from '../case-board/case-board.events';

@Global()
@Module({
  providers: [
    RunnerEventsGateway,
    NotificationEventsGateway,
    CaseBoardGateway,
    // The board's ops path depends on this token, not on the gateway class.
    { provide: CASE_BOARD_EVENTS, useExisting: CaseBoardGateway },
  ],
  exports: [
    RunnerEventsGateway,
    NotificationEventsGateway,
    CaseBoardGateway,
    CASE_BOARD_EVENTS,
  ],
})
export class WebSocketModule {}
