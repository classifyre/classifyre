/* tslint:disable */
/* eslint-disable */

export interface ThreadEntryDto {
    id: string;
    threadId: string;
    entryType: ThreadEntryDtoEntryTypeEnum;
    body?: string | null;
    metadata?: Record<string, unknown> | null;
    author?: string | null;
    createdAt: Date;
}

export const ThreadEntryDtoEntryTypeEnum = {
    Note: 'NOTE',
    Statement: 'STATEMENT',
    StatusChange: 'STATUS_CHANGE',
    ConfidenceChange: 'CONFIDENCE_CHANGE',
} as const;
export type ThreadEntryDtoEntryTypeEnum = typeof ThreadEntryDtoEntryTypeEnum[keyof typeof ThreadEntryDtoEntryTypeEnum];

export function instanceOfThreadEntryDto(value: object): value is ThreadEntryDto {
    if (!('id' in value)) return false;
    if (!('threadId' in value)) return false;
    if (!('entryType' in value)) return false;
    if (!('createdAt' in value)) return false;
    return true;
}

export function ThreadEntryDtoFromJSON(json: any): ThreadEntryDto {
    return ThreadEntryDtoFromJSONTyped(json, false);
}

export function ThreadEntryDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): ThreadEntryDto {
    if (json == null) return json;
    return {
        id: json['id'],
        threadId: json['threadId'],
        entryType: json['entryType'],
        body: json['body'] == null ? undefined : json['body'],
        metadata: json['metadata'] == null ? undefined : json['metadata'],
        author: json['author'] == null ? undefined : json['author'],
        createdAt: new Date(json['createdAt']),
    };
}

export function ThreadEntryDtoToJSON(json: any): ThreadEntryDto {
    return ThreadEntryDtoToJSONTyped(json, false);
}

export function ThreadEntryDtoToJSONTyped(value?: ThreadEntryDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        id: value['id'],
        threadId: value['threadId'],
        entryType: value['entryType'],
        body: value['body'],
        metadata: value['metadata'],
        author: value['author'],
        createdAt: value['createdAt'].toISOString(),
    };
}
