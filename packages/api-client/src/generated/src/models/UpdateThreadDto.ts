/* tslint:disable */
/* eslint-disable */

export interface UpdateThreadDto {
    title?: string;
    status?: UpdateThreadDtoStatusEnum | null;
    confidence?: number | null;
    color?: string | null;
    actor?: string;
}

export const UpdateThreadDtoStatusEnum = {
    Proposed: 'PROPOSED',
    Supported: 'SUPPORTED',
    Refuted: 'REFUTED',
    Inconclusive: 'INCONCLUSIVE',
} as const;
export type UpdateThreadDtoStatusEnum = typeof UpdateThreadDtoStatusEnum[keyof typeof UpdateThreadDtoStatusEnum];

export function instanceOfUpdateThreadDto(_value: object): _value is UpdateThreadDto {
    return true;
}

export function UpdateThreadDtoFromJSON(json: any): UpdateThreadDto {
    return UpdateThreadDtoFromJSONTyped(json, false);
}

export function UpdateThreadDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): UpdateThreadDto {
    if (json == null) return json;
    return {
        title: json['title'] == null ? undefined : json['title'],
        status: json['status'] == null ? undefined : json['status'],
        confidence: json['confidence'] == null ? undefined : json['confidence'],
        color: json['color'] == null ? undefined : json['color'],
        actor: json['actor'] == null ? undefined : json['actor'],
    };
}

export function UpdateThreadDtoToJSON(json: any): UpdateThreadDto {
    return UpdateThreadDtoToJSONTyped(json, false);
}

export function UpdateThreadDtoToJSONTyped(value?: UpdateThreadDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        title: value['title'],
        status: value['status'],
        confidence: value['confidence'],
        color: value['color'],
        actor: value['actor'],
    };
}
