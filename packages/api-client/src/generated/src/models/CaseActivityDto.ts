/* tslint:disable */
/* eslint-disable */

export interface CaseActivityDto {
    id: string;
    caseId: string;
    activityType: string;
    actor?: string | null;
    payload: Record<string, unknown>;
    createdAt: Date;
}

export function instanceOfCaseActivityDto(value: object): value is CaseActivityDto {
    if (!('id' in value)) return false;
    if (!('caseId' in value)) return false;
    if (!('activityType' in value)) return false;
    if (!('payload' in value)) return false;
    if (!('createdAt' in value)) return false;
    return true;
}

export function CaseActivityDtoFromJSON(json: any): CaseActivityDto {
    return CaseActivityDtoFromJSONTyped(json, false);
}

export function CaseActivityDtoFromJSONTyped(json: any, _ignoreDiscriminator: boolean): CaseActivityDto {
    if (json == null) return json;
    return {
        id: json['id'],
        caseId: json['caseId'],
        activityType: json['activityType'],
        actor: json['actor'] == null ? undefined : json['actor'],
        payload: json['payload'] ?? {},
        createdAt: new Date(json['createdAt']),
    };
}

export function CaseActivityDtoToJSON(json: any): CaseActivityDto {
    return CaseActivityDtoToJSONTyped(json, false);
}

export function CaseActivityDtoToJSONTyped(value?: CaseActivityDto | null, _ignoreDiscriminator = false): any {
    if (value == null) return value;
    return {
        id: value['id'],
        caseId: value['caseId'],
        activityType: value['activityType'],
        actor: value['actor'],
        payload: value['payload'],
        createdAt: value['createdAt'].toISOString(),
    };
}
