/* tslint:disable */
/* eslint-disable */

import { mapValues } from '../runtime';

export interface ThreadSupportLinkDto {
    id: string;
    targetType: string;
    targetId: string;
    stance: ThreadSupportLinkDtoStanceEnum;
    weight?: number | null;
    note?: string | null;
    targetLabel: string;
    createdAt: Date;
}

export const ThreadSupportLinkDtoStanceEnum = {
    Supports: 'SUPPORTS',
    Contradicts: 'CONTRADICTS',
    Neutral: 'NEUTRAL',
} as const;
export type ThreadSupportLinkDtoStanceEnum = typeof ThreadSupportLinkDtoStanceEnum[keyof typeof ThreadSupportLinkDtoStanceEnum];

export function instanceOfThreadSupportLinkDto(value: object): value is ThreadSupportLinkDto {
    if (!('id' in value)) return false;
    if (!('targetType' in value)) return false;
    if (!('targetId' in value)) return false;
    if (!('stance' in value)) return false;
    if (!('targetLabel' in value)) return false;
    if (!('createdAt' in value)) return false;
    return true;
}

export function ThreadSupportLinkDtoFromJSON(json: any): ThreadSupportLinkDto {
    return ThreadSupportLinkDtoFromJSONTyped(json, false);
}

export function ThreadSupportLinkDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): ThreadSupportLinkDto {
    if (json == null) return json;
    return {
        id: json['id'],
        targetType: json['targetType'],
        targetId: json['targetId'],
        stance: json['stance'],
        weight: json['weight'] == null ? undefined : json['weight'],
        note: json['note'] == null ? undefined : json['note'],
        targetLabel: json['targetLabel'],
        createdAt: new Date(json['createdAt']),
    };
}

export function ThreadSupportLinkDtoToJSON(json: any): ThreadSupportLinkDto {
    return ThreadSupportLinkDtoToJSONTyped(json, false);
}

export function ThreadSupportLinkDtoToJSONTyped(value?: ThreadSupportLinkDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        id: value['id'],
        targetType: value['targetType'],
        targetId: value['targetId'],
        stance: value['stance'],
        weight: value['weight'],
        note: value['note'],
        targetLabel: value['targetLabel'],
        createdAt: value['createdAt'].toISOString(),
    };
}
