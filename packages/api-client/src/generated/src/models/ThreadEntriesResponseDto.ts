/* tslint:disable */
/* eslint-disable */

import type { ThreadEntryDto } from './ThreadEntryDto';
import { ThreadEntryDtoFromJSON, ThreadEntryDtoToJSON } from './ThreadEntryDto';

export interface ThreadEntriesResponseDto {
    items: Array<ThreadEntryDto>;
    nextCursor: string | null;
}

export function instanceOfThreadEntriesResponseDto(value: object): value is ThreadEntriesResponseDto {
    if (!('items' in value)) return false;
    if (!('nextCursor' in value)) return false;
    return true;
}

export function ThreadEntriesResponseDtoFromJSON(json: any): ThreadEntriesResponseDto {
    return ThreadEntriesResponseDtoFromJSONTyped(json, false);
}

export function ThreadEntriesResponseDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): ThreadEntriesResponseDto {
    if (json == null) return json;
    return {
        items: (json['items'] as Array<any>).map(ThreadEntryDtoFromJSON),
        nextCursor: json['nextCursor'],
    };
}

export function ThreadEntriesResponseDtoToJSON(json: any): ThreadEntriesResponseDto {
    return ThreadEntriesResponseDtoToJSONTyped(json, false);
}

export function ThreadEntriesResponseDtoToJSONTyped(value?: ThreadEntriesResponseDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        items: value['items'].map(ThreadEntryDtoToJSON),
        nextCursor: value['nextCursor'],
    };
}
