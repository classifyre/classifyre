import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { FindingContentService } from './finding-content.service';

/**
 * Every JSON response of the API passes here: the content of findings the
 * person may not read is hidden wherever it appears (FindingContentService).
 * One place, so a new endpoint that returns findings is covered without
 * anyone remembering to.
 */
@Injectable()
export class FindingContentInterceptor implements NestInterceptor {
  constructor(private readonly content: FindingContentService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next
      .handle()
      .pipe(mergeMap((body: unknown) => from(this.content.redact(body))));
  }
}
