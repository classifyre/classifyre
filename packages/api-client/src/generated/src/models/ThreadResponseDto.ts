/* tslint:disable */
/* eslint-disable */

import type { ThreadSupportLinkDto } from './ThreadSupportLinkDto';
import { ThreadSupportLinkDtoFromJSON, ThreadSupportLinkDtoToJSON } from './ThreadSupportLinkDto';
import type { ThreadEntryDto } from './ThreadEntryDto';
import { ThreadEntryDtoFromJSON, ThreadEntryDtoToJSON } from './ThreadEntryDto';

export interface ThreadResponseDto {
    id: string;
    caseId: string;
    kind: ThreadResponseDtoKindEnum;
    title: string;
    status?: ThreadResponseDtoStatusEnum | null;
    confidence?: number | null;
    color?: string | null;
    createdBy?: string | null;
    supportingCount: number;
    contradictingCount: number;
    links: Array<ThreadSupportLinkDto>;
    entries: Array<ThreadEntryDto>;
    createdAt: Date;
    updatedAt: Date;
}

export const ThreadResponseDtoKindEnum = {
    Hypothesis: 'HYPOTHESIS',
    Discussion: 'DISCUSSION',
} as const;
export type ThreadResponseDtoKindEnum = typeof ThreadResponseDtoKindEnum[keyof typeof ThreadResponseDtoKindEnum];

export const ThreadResponseDtoStatusEnum = {
    Proposed: 'PROPOSED',
    Supported: 'SUPPORTED',
    Refuted: 'REFUTED',
    Inconclusive: 'INCONCLUSIVE',
} as const;
export type ThreadResponseDtoStatusEnum = typeof ThreadResponseDtoStatusEnum[keyof typeof ThreadResponseDtoStatusEnum];

export function instanceOfThreadResponseDto(value: object): value is ThreadResponseDto {
    if (!('id' in value)) return false;
    if (!('caseId' in value)) return false;
    if (!('kind' in value)) return false;
    if (!('title' in value)) return false;
    if (!('supportingCount' in value)) return false;
    if (!('contradictingCount' in value)) return false;
    if (!('links' in value)) return false;
    if (!('entries' in value)) return false;
    if (!('createdAt' in value)) return false;
    if (!('updatedAt' in value)) return false;
    return true;
}

export function ThreadResponseDtoFromJSON(json: any): ThreadResponseDto {
    return ThreadResponseDtoFromJSONTyped(json, false);
}

export function ThreadResponseDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): ThreadResponseDto {
    if (json == null) return json;
    return {
        id: json['id'],
        caseId: json['caseId'],
        kind: json['kind'],
        title: json['title'],
        status: json['status'] == null ? undefined : json['status'],
        confidence: json['confidence'] == null ? undefined : json['confidence'],
        color: json['color'] == null ? undefined : json['color'],
        createdBy: json['createdBy'] == null ? undefined : json['createdBy'],
        supportingCount: json['supportingCount'],
        contradictingCount: json['contradictingCount'],
        links: (json['links'] as Array<any>).map(ThreadSupportLinkDtoFromJSON),
        entries: (json['entries'] as Array<any>).map(ThreadEntryDtoFromJSON),
        createdAt: new Date(json['createdAt']),
        updatedAt: new Date(json['updatedAt']),
    };
}

export function ThreadResponseDtoToJSON(json: any): ThreadResponseDto {
    return ThreadResponseDtoToJSONTyped(json, false);
}

export function ThreadResponseDtoToJSONTyped(value?: ThreadResponseDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        id: value['id'],
        caseId: value['caseId'],
        kind: value['kind'],
        title: value['title'],
        status: value['status'],
        confidence: value['confidence'],
        color: value['color'],
        createdBy: value['createdBy'],
        supportingCount: value['supportingCount'],
        contradictingCount: value['contradictingCount'],
        links: value['links'].map(ThreadSupportLinkDtoToJSON),
        entries: value['entries'].map(ThreadEntryDtoToJSON),
        createdAt: value['createdAt'].toISOString(),
        updatedAt: value['updatedAt'].toISOString(),
    };
}
