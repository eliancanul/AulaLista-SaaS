/** Typed client for secure real documents, OCR extraction, revocation/purge, and cited web search. */

import type { AcentaApi } from "./api";
import type { AdaptationMode, AnnexDocument, DidacticToolId } from "./annex-api";

export interface TeacherDocumentItem {
  id: string;
  scope_id: string;
  filename: string;
  detected_mime: string;
  size_bytes: number;
  sha256: string;
  status: "pending" | "ready" | "failed" | "revoked";
  page_count: number;
  ocr_engine: string;
  error_code: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  text_preview?: string;
  extracted_text?: string | null;
}

export interface CitedWebResult {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  accessed_at: string;
}

export class DocumentsClient {
  constructor(private readonly api: AcentaApi) {}

  async listDocuments(): Promise<TeacherDocumentItem[]> {
    const res = (await this.api.scopedJson("documents")) as {
      items: TeacherDocumentItem[];
    };
    return res.items;
  }

  async readDocument(docId: string): Promise<TeacherDocumentItem> {
    return (await this.api.scopedJson(
      `documents/${docId}`,
    )) as TeacherDocumentItem;
  }

  async uploadDocument(
    filename: string,
    contentBase64: string,
  ): Promise<TeacherDocumentItem> {
    return (await this.api.scopedJson(
      "documents",
      "POST",
      { filename, content_base64: contentBase64 },
      45000,
    )) as TeacherDocumentItem;
  }

  async revokeDocument(docId: string): Promise<TeacherDocumentItem> {
    return (await this.api.scopedJson(
      `documents/${docId}/revoke`,
      "POST",
    )) as TeacherDocumentItem;
  }

  async generateAnnexFromDocument(
    docId: string,
    input: {
      tool_id: DidacticToolId;
      subject: string;
      grade: string;
      topic?: string;
      adaptation_mode?: AdaptationMode;
    },
  ): Promise<AnnexDocument> {
    return (await this.api.scopedJson(
      `documents/${docId}/generate-annex`,
      "POST",
      input,
      30000,
    )) as AnnexDocument;
  }

  async webSearch(
    query: string,
    maxResults = 5,
  ): Promise<{ query: string; citations: CitedWebResult[]; count: number }> {
    return (await this.api.scopedJson(
      "web-search",
      "POST",
      { query, max_results: maxResults, language: "es" },
      15000,
    )) as { query: string; citations: CitedWebResult[]; count: number };
  }
}
