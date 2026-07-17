import {
  api,
  type DeleteGlossaryTermResponseDto,
  type GlossaryListResponseDto,
  type GlossaryTermDto,
  type UpsertGlossaryTermResponseDto,
} from "@workspace/api-client";

/**
 * Thin typed wrapper around `api.glossary.*`.
 *
 * `@workspace/api-client` now carries full response DTOs for the
 * `GlossaryController` endpoints, so this just re-exports the generated
 * types/typed methods under the names this app already imports.
 */

export type { GlossaryTermDto } from "@workspace/api-client";

export type GlossaryEntityType = GlossaryTermDto["entityType"];

export const GLOSSARY_ENTITY_TYPES: GlossaryEntityType[] = [
  "PERSON",
  "ORGANIZATION",
  "LOCATION",
  "REFERENCE",
  "TERM",
  "OTHER",
];

export type GlossaryUpsertResult = UpsertGlossaryTermResponseDto;

export type GlossaryListResult = GlossaryListResponseDto;

type ListParams = NonNullable<
  Parameters<typeof api.glossary.glossaryControllerList>[0]
>;
type UpsertParams = Parameters<
  typeof api.glossary.glossaryControllerUpsert
>[0];
type VerifyParams = Parameters<
  typeof api.glossary.glossaryControllerVerify
>[0];
type RemoveParams = Parameters<
  typeof api.glossary.glossaryControllerRemove
>[0];

export async function listGlossaryTerms(
  params: ListParams,
): Promise<GlossaryListResult> {
  return api.glossary.glossaryControllerList(params);
}

export async function upsertGlossaryTerm(
  params: UpsertParams,
): Promise<GlossaryUpsertResult> {
  return api.glossary.glossaryControllerUpsert(params);
}

export async function verifyGlossaryTerm(
  params: VerifyParams,
): Promise<GlossaryTermDto> {
  return api.glossary.glossaryControllerVerify(params);
}

export async function removeGlossaryTerm(
  params: RemoveParams,
): Promise<DeleteGlossaryTermResponseDto> {
  return api.glossary.glossaryControllerRemove(params);
}
