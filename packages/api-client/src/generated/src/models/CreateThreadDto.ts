/* tslint:disable */
/* eslint-disable */

export interface CreateThreadDto {
    kind: CreateThreadDtoKindEnum;
    title: string;
    statement?: string;
    status?: CreateThreadDtoStatusEnum;
    confidence?: number;
    createdBy?: string;
}

export const CreateThreadDtoKindEnum = {
    Hypothesis: 'HYPOTHESIS',
    Discussion: 'DISCUSSION',
} as const;
export type CreateThreadDtoKindEnum = typeof CreateThreadDtoKindEnum[keyof typeof CreateThreadDtoKindEnum];

export const CreateThreadDtoStatusEnum = {
    Proposed: 'PROPOSED',
    Supported: 'SUPPORTED',
    Refuted: 'REFUTED',
    Inconclusive: 'INCONCLUSIVE',
} as const;
export type CreateThreadDtoStatusEnum = typeof CreateThreadDtoStatusEnum[keyof typeof CreateThreadDtoStatusEnum];

export function instanceOfCreateThreadDto(value: object): value is CreateThreadDto {
    if (!('kind' in value)) return false;
    if (!('title' in value)) return false;
    return true;
}

export function CreateThreadDtoFromJSON(json: any): CreateThreadDto {
    return CreateThreadDtoFromJSONTyped(json, false);
}

export function CreateThreadDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): CreateThreadDto {
    if (json == null) return json;
    return {
        kind: json['kind'],
        title: json['title'],
        statement: json['statement'] == null ? undefined : json['statement'],
        status: json['status'] == null ? undefined : json['status'],
        confidence: json['confidence'] == null ? undefined : json['confidence'],
        createdBy: json['createdBy'] == null ? undefined : json['createdBy'],
    };
}

export function CreateThreadDtoToJSON(json: any): CreateThreadDto {
    return CreateThreadDtoToJSONTyped(json, false);
}

export function CreateThreadDtoToJSONTyped(value?: CreateThreadDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        kind: value['kind'],
        title: value['title'],
        statement: value['statement'],
        status: value['status'],
        confidence: value['confidence'],
        createdBy: value['createdBy'],
    };
}
