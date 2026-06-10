/* tslint:disable */
/* eslint-disable */

import * as runtime from '../runtime';
import type {
    AddThreadEntryDto,
    CaseTimelineResponseDto,
    CreateThreadDto,
    LinkThreadSupportDto,
    ThreadEntriesResponseDto,
    ThreadResponseDto,
    UpdateThreadDto,
} from '../models/index';
import {
    AddThreadEntryDtoToJSON,
    CaseTimelineResponseDtoFromJSON,
    CreateThreadDtoToJSON,
    LinkThreadSupportDtoToJSON,
    ThreadEntriesResponseDtoFromJSON,
    ThreadResponseDtoFromJSON,
    UpdateThreadDtoToJSON,
} from '../models/index';

export interface ThreadsControllerListRequest {
    caseId: string;
}

export interface ThreadsControllerCreateRequest {
    caseId: string;
    createThreadDto: CreateThreadDto;
}

export interface ThreadsControllerUpdateRequest {
    id: string;
    updateThreadDto: UpdateThreadDto;
}

export interface ThreadsControllerRemoveRequest {
    id: string;
}

export interface ThreadsControllerAddEntryRequest {
    id: string;
    addThreadEntryDto: AddThreadEntryDto;
}

export interface ThreadsControllerGetEntriesRequest {
    id: string;
    cursor?: string;
    limit?: number;
}

export interface ThreadsControllerLinkSupportRequest {
    id: string;
    linkThreadSupportDto: LinkThreadSupportDto;
}

export interface ThreadsControllerUnlinkSupportRequest {
    id: string;
    linkId: string;
}

export interface ThreadsControllerTimelineRequest {
    caseId: string;
    cursor?: string;
    limit?: number;
}

export class ThreadsApi extends runtime.BaseAPI {

    async threadsControllerListRaw(req: ThreadsControllerListRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<Array<ThreadResponseDto>>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = {};
        let urlPath = `/cases/{caseId}/threads`;
        urlPath = urlPath.replace(`{${'caseId'}}`, encodeURIComponent(String(req['caseId'])));
        const response = await this.request({ path: urlPath, method: 'GET', headers: headerParameters, query: queryParameters }, initOverrides);
        return new runtime.JSONApiResponse(response, (j) => j.map(ThreadResponseDtoFromJSON));
    }

    async threadsControllerList(req: ThreadsControllerListRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<Array<ThreadResponseDto>> {
        return (await this.threadsControllerListRaw(req, initOverrides)).value();
    }

    async threadsControllerCreateRaw(req: ThreadsControllerCreateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadResponseDto>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = { 'Content-Type': 'application/json' };
        let urlPath = `/cases/{caseId}/threads`;
        urlPath = urlPath.replace(`{${'caseId'}}`, encodeURIComponent(String(req['caseId'])));
        const response = await this.request({ path: urlPath, method: 'POST', headers: headerParameters, query: queryParameters, body: CreateThreadDtoToJSON(req['createThreadDto']) }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadResponseDtoFromJSON);
    }

    async threadsControllerCreate(req: ThreadsControllerCreateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadResponseDto> {
        return (await this.threadsControllerCreateRaw(req, initOverrides)).value();
    }

    async threadsControllerUpdateRaw(req: ThreadsControllerUpdateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadResponseDto>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = { 'Content-Type': 'application/json' };
        let urlPath = `/threads/{id}`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        const response = await this.request({ path: urlPath, method: 'PATCH', headers: headerParameters, query: queryParameters, body: UpdateThreadDtoToJSON(req['updateThreadDto']) }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadResponseDtoFromJSON);
    }

    async threadsControllerUpdate(req: ThreadsControllerUpdateRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadResponseDto> {
        return (await this.threadsControllerUpdateRaw(req, initOverrides)).value();
    }

    async threadsControllerRemoveRaw(req: ThreadsControllerRemoveRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<void>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = {};
        let urlPath = `/threads/{id}`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        const response = await this.request({ path: urlPath, method: 'DELETE', headers: headerParameters, query: queryParameters }, initOverrides);
        return new runtime.VoidApiResponse(response);
    }

    async threadsControllerRemove(req: ThreadsControllerRemoveRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<void> {
        await this.threadsControllerRemoveRaw(req, initOverrides);
    }

    async threadsControllerAddEntryRaw(req: ThreadsControllerAddEntryRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadResponseDto>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = { 'Content-Type': 'application/json' };
        let urlPath = `/threads/{id}/entries`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        const response = await this.request({ path: urlPath, method: 'POST', headers: headerParameters, query: queryParameters, body: AddThreadEntryDtoToJSON(req['addThreadEntryDto']) }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadResponseDtoFromJSON);
    }

    async threadsControllerAddEntry(req: ThreadsControllerAddEntryRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadResponseDto> {
        return (await this.threadsControllerAddEntryRaw(req, initOverrides)).value();
    }

    async threadsControllerGetEntriesRaw(req: ThreadsControllerGetEntriesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadEntriesResponseDto>> {
        const queryParameters: any = {};
        if (req['cursor'] != null) queryParameters['cursor'] = req['cursor'];
        if (req['limit'] != null) queryParameters['limit'] = req['limit'];
        const headerParameters: runtime.HTTPHeaders = {};
        let urlPath = `/threads/{id}/entries`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        const response = await this.request({ path: urlPath, method: 'GET', headers: headerParameters, query: queryParameters }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadEntriesResponseDtoFromJSON);
    }

    async threadsControllerGetEntries(req: ThreadsControllerGetEntriesRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadEntriesResponseDto> {
        return (await this.threadsControllerGetEntriesRaw(req, initOverrides)).value();
    }

    async threadsControllerLinkSupportRaw(req: ThreadsControllerLinkSupportRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadResponseDto>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = { 'Content-Type': 'application/json' };
        let urlPath = `/threads/{id}/support`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        const response = await this.request({ path: urlPath, method: 'POST', headers: headerParameters, query: queryParameters, body: LinkThreadSupportDtoToJSON(req['linkThreadSupportDto']) }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadResponseDtoFromJSON);
    }

    async threadsControllerLinkSupport(req: ThreadsControllerLinkSupportRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadResponseDto> {
        return (await this.threadsControllerLinkSupportRaw(req, initOverrides)).value();
    }

    async threadsControllerUnlinkSupportRaw(req: ThreadsControllerUnlinkSupportRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<ThreadResponseDto>> {
        const queryParameters: any = {};
        const headerParameters: runtime.HTTPHeaders = {};
        let urlPath = `/threads/{id}/support/{linkId}`;
        urlPath = urlPath.replace(`{${'id'}}`, encodeURIComponent(String(req['id'])));
        urlPath = urlPath.replace(`{${'linkId'}}`, encodeURIComponent(String(req['linkId'])));
        const response = await this.request({ path: urlPath, method: 'DELETE', headers: headerParameters, query: queryParameters }, initOverrides);
        return new runtime.JSONApiResponse(response, ThreadResponseDtoFromJSON);
    }

    async threadsControllerUnlinkSupport(req: ThreadsControllerUnlinkSupportRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<ThreadResponseDto> {
        return (await this.threadsControllerUnlinkSupportRaw(req, initOverrides)).value();
    }

    async threadsControllerTimelineRaw(req: ThreadsControllerTimelineRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<runtime.ApiResponse<CaseTimelineResponseDto>> {
        const queryParameters: any = {};
        if (req['cursor'] != null) queryParameters['cursor'] = req['cursor'];
        if (req['limit'] != null) queryParameters['limit'] = req['limit'];
        const headerParameters: runtime.HTTPHeaders = {};
        let urlPath = `/cases/{caseId}/timeline`;
        urlPath = urlPath.replace(`{${'caseId'}}`, encodeURIComponent(String(req['caseId'])));
        const response = await this.request({ path: urlPath, method: 'GET', headers: headerParameters, query: queryParameters }, initOverrides);
        return new runtime.JSONApiResponse(response, CaseTimelineResponseDtoFromJSON);
    }

    async threadsControllerTimeline(req: ThreadsControllerTimelineRequest, initOverrides?: RequestInit | runtime.InitOverrideFunction): Promise<CaseTimelineResponseDto> {
        return (await this.threadsControllerTimelineRaw(req, initOverrides)).value();
    }
}
