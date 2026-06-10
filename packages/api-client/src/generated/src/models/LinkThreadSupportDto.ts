/* tslint:disable */
/* eslint-disable */

export interface LinkThreadSupportDto {
    targetType: LinkThreadSupportDtoTargetTypeEnum;
    targetId: string;
    stance?: LinkThreadSupportDtoStanceEnum;
    weight?: number;
    note?: string;
}

export const LinkThreadSupportDtoTargetTypeEnum = {
    Evidence: 'evidence',
    Finding: 'finding',
} as const;
export type LinkThreadSupportDtoTargetTypeEnum = typeof LinkThreadSupportDtoTargetTypeEnum[keyof typeof LinkThreadSupportDtoTargetTypeEnum];

export const LinkThreadSupportDtoStanceEnum = {
    Supports: 'SUPPORTS',
    Contradicts: 'CONTRADICTS',
    Neutral: 'NEUTRAL',
} as const;
export type LinkThreadSupportDtoStanceEnum = typeof LinkThreadSupportDtoStanceEnum[keyof typeof LinkThreadSupportDtoStanceEnum];

export function instanceOfLinkThreadSupportDto(value: object): value is LinkThreadSupportDto {
    if (!('targetType' in value)) return false;
    if (!('targetId' in value)) return false;
    return true;
}

export function LinkThreadSupportDtoFromJSON(json: any): LinkThreadSupportDto {
    return LinkThreadSupportDtoFromJSONTyped(json, false);
}

export function LinkThreadSupportDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): LinkThreadSupportDto {
    if (json == null) return json;
    return {
        targetType: json['targetType'],
        targetId: json['targetId'],
        stance: json['stance'] == null ? undefined : json['stance'],
        weight: json['weight'] == null ? undefined : json['weight'],
        note: json['note'] == null ? undefined : json['note'],
    };
}

export function LinkThreadSupportDtoToJSON(json: any): LinkThreadSupportDto {
    return LinkThreadSupportDtoToJSONTyped(json, false);
}

export function LinkThreadSupportDtoToJSONTyped(value?: LinkThreadSupportDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        targetType: value['targetType'],
        targetId: value['targetId'],
        stance: value['stance'],
        weight: value['weight'],
        note: value['note'],
    };
}
