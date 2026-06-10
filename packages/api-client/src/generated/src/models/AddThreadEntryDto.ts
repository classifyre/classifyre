/* tslint:disable */
/* eslint-disable */

export interface AddThreadEntryDto {
    entryType: AddThreadEntryDtoEntryTypeEnum;
    body?: string;
    author?: string;
}

export const AddThreadEntryDtoEntryTypeEnum = {
    Note: 'NOTE',
    Statement: 'STATEMENT',
    StatusChange: 'STATUS_CHANGE',
    ConfidenceChange: 'CONFIDENCE_CHANGE',
} as const;
export type AddThreadEntryDtoEntryTypeEnum = typeof AddThreadEntryDtoEntryTypeEnum[keyof typeof AddThreadEntryDtoEntryTypeEnum];

export function instanceOfAddThreadEntryDto(value: object): value is AddThreadEntryDto {
    if (!('entryType' in value)) return false;
    return true;
}

export function AddThreadEntryDtoFromJSON(json: any): AddThreadEntryDto {
    return AddThreadEntryDtoFromJSONTyped(json, false);
}

export function AddThreadEntryDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): AddThreadEntryDto {
    if (json == null) return json;
    return {
        entryType: json['entryType'],
        body: json['body'] == null ? undefined : json['body'],
        author: json['author'] == null ? undefined : json['author'],
    };
}

export function AddThreadEntryDtoToJSON(json: any): AddThreadEntryDto {
    return AddThreadEntryDtoToJSONTyped(json, false);
}

export function AddThreadEntryDtoToJSONTyped(value?: AddThreadEntryDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        entryType: value['entryType'],
        body: value['body'],
        author: value['author'],
    };
}
