/* tslint:disable */
/* eslint-disable */

import type { CaseActivityDto } from './CaseActivityDto';
import { CaseActivityDtoFromJSON, CaseActivityDtoToJSON } from './CaseActivityDto';

export interface CaseTimelineResponseDto {
    items: Array<CaseActivityDto>;
    nextCursor: string | null;
}

export function instanceOfCaseTimelineResponseDto(value: object): value is CaseTimelineResponseDto {
    if (!('items' in value)) return false;
    if (!('nextCursor' in value)) return false;
    return true;
}

export function CaseTimelineResponseDtoFromJSON(json: any): CaseTimelineResponseDto {
    return CaseTimelineResponseDtoFromJSONTyped(json, false);
}

export function CaseTimelineResponseDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): CaseTimelineResponseDto {
    if (json == null) return json;
    return {
        items: (json['items'] as Array<any>).map(CaseActivityDtoFromJSON),
        nextCursor: json['nextCursor'],
    };
}

export function CaseTimelineResponseDtoToJSON(json: any): CaseTimelineResponseDto {
    return CaseTimelineResponseDtoToJSONTyped(json, false);
}

export function CaseTimelineResponseDtoToJSONTyped(value?: CaseTimelineResponseDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        items: value['items'].map(CaseActivityDtoToJSON),
        nextCursor: value['nextCursor'],
    };
}
