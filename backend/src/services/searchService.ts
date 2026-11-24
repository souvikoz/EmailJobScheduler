import { query } from '../config/db.js';
import { esClient } from '../config/elasticsearch.js';
import { env } from '../config/env.js';
import type { EmailRow, EmailStatus } from '../types/index.js';

interface EmailSearchDoc {
  id: string;
  user_id: string;
  campaign_id: string | null;
  sender_id: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  status: EmailStatus;
  scheduled_at: string;
  sent_at: string | null;
  failed_at: string | null;
  ethereal_preview_url: string | null;
  is_starred: boolean;
  is_archived: boolean;
  created_at: string;
}

function toSearchDoc(row: EmailRow): EmailSearchDoc {
  return {
    id: row.id,
    user_id: row.user_id,
    campaign_id: row.campaign_id,
    sender_id: row.sender_id,
    sender_email: row.sender_email,
    sender_name: row.sender_name,
    recipient_email: row.recipient_email,
    subject: row.subject,
    body_text: row.body_text,
    status: row.status,
    scheduled_at: row.scheduled_at.toISOString(),
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    failed_at: row.failed_at ? row.failed_at.toISOString() : null,
    ethereal_preview_url: row.ethereal_preview_url,
    is_starred: row.is_starred,
    is_archived: row.is_archived,
    created_at: row.created_at.toISOString(),
  };
}

export async function indexEmailDocument(row: EmailRow): Promise<void> {
  try {
    await esClient.index({
      index: env.ELASTICSEARCH_INDEX,
      id: row.id,
      document: toSearchDoc(row),
      refresh: 'wait_for',
    });
  } catch (err) {
    console.warn('[Elasticsearch] Failed to index email:', row.id, err instanceof Error ? err.message : err);
  }
}

export async function bulkIndexEmailDocuments(rows: EmailRow[]): Promise<void> {
  if (rows.length === 0) return;

  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const operations = chunk.flatMap((row) => [
      { index: { _index: env.ELASTICSEARCH_INDEX, _id: row.id } },
      toSearchDoc(row),
    ]);
    try {
      const resp = await esClient.bulk({ operations, refresh: 'wait_for' });
      if (resp.errors) {
        console.warn('[Elasticsearch] Partial bulk indexing errors occurred');
      }
    } catch (err) {
      console.warn('[Elasticsearch] Bulk index failed:', err instanceof Error ? err.message : err);
    }
  }
}

export async function updateEmailDocument(
  emailId: string,
  partial: Partial<{
    status: EmailStatus;
    scheduled_at: Date;
    sent_at: Date | null;
    failed_at: Date | null;
    ethereal_preview_url: string | null;
    is_starred: boolean;
    is_archived: boolean;
  }>
): Promise<void> {
  const doc: Record<string, unknown> = {};
  if (partial.status !== undefined) doc.status = partial.status;
  if (partial.scheduled_at !== undefined) doc.scheduled_at = partial.scheduled_at.toISOString();
  if (partial.sent_at !== undefined) doc.sent_at = partial.sent_at ? partial.sent_at.toISOString() : null;
  if (partial.failed_at !== undefined) doc.failed_at = partial.failed_at ? partial.failed_at.toISOString() : null;
  if (partial.ethereal_preview_url !== undefined) doc.ethereal_preview_url = partial.ethereal_preview_url;
  if (partial.is_starred !== undefined) doc.is_starred = partial.is_starred;
  if (partial.is_archived !== undefined) doc.is_archived = partial.is_archived;

  if (Object.keys(doc).length === 0) return;

  try {
    await esClient.update({
      index: env.ELASTICSEARCH_INDEX,
      id: emailId,
      doc,
      refresh: 'wait_for',
    });
  } catch {
    // If doc isn't indexed yet, reindex canonical row from PostgreSQL
    const { rows } = await query<EmailRow>('SELECT * FROM emails WHERE id = $1', [emailId]);
    if (rows[0]) {
      await indexEmailDocument(rows[0]);
    }
  }
}

export async function deleteEmailDocument(emailId: string): Promise<void> {
  try {
    await esClient.delete({
      index: env.ELASTICSEARCH_INDEX,
      id: emailId,
      refresh: 'wait_for',
    });
  } catch {
    // Ignore 404 or transient index delete errors
  }
}

export interface SearchEmailsParams {
  userId: string;
  tab: 'scheduled' | 'sent';
  queryText?: string;
  statusFilter?: EmailStatus;
  senderId?: string;
  starredOnly?: boolean;
  page: number;
  limit: number;
}

export async function searchUserEmailsWithElasticsearch(params: SearchEmailsParams): Promise<{
  emails: EmailRow[];
  total: number;
  searchEngine: 'elasticsearch' | 'postgresql_fallback';
}> {
  const tabStatuses: EmailStatus[] =
    params.tab === 'scheduled'
      ? ['scheduled', 'queued', 'processing', 'rate_limited']
      : ['sent', 'failed'];

  const allowedStatuses =
    params.statusFilter && tabStatuses.includes(params.statusFilter)
      ? [params.statusFilter]
      : tabStatuses;

  const filters: Array<Record<string, unknown>> = [
    { term: { user_id: params.userId } },
    { term: { is_archived: false } },
    { terms: { status: allowedStatuses } },
  ];

  if (params.senderId) {
    filters.push({ term: { sender_id: params.senderId } });
  }
  if (params.starredOnly) {
    filters.push({ term: { is_starred: true } });
  }

  const trimmedQuery = params.queryText?.trim();
  const mustClauses: Array<Record<string, unknown>> = [];
  if (trimmedQuery) {
    const hasDigitsOrAt = /[\d@]/.test(trimmedQuery);
    const shouldClauses: Array<Record<string, unknown>> = [
      {
        multi_match: {
          query: trimmedQuery,
          fields: ['subject^3', 'recipient_email^3', 'body_text', 'sender_email^2', 'sender_name'],
          type: 'best_fields',
          operator: 'and',
        },
      },
      {
        multi_match: {
          query: trimmedQuery,
          fields: ['subject^3', 'recipient_email^3', 'body_text', 'sender_email^2'],
          type: 'phrase_prefix',
        },
      },
      {
        wildcard: {
          'recipient_email.keyword': {
            value: `*${trimmedQuery.toLowerCase()}*`,
            case_insensitive: true,
          },
        },
      },
    ];

    if (!hasDigitsOrAt && trimmedQuery.length >= 4) {
      shouldClauses.push({
        multi_match: {
          query: trimmedQuery,
          fields: ['subject^2', 'body_text', 'sender_name'],
          type: 'best_fields',
          operator: 'and',
          fuzziness: 'AUTO',
          prefix_length: 2,
        },
      });
    }

    mustClauses.push({
      bool: {
        should: shouldClauses,
        minimum_should_match: 1,
      },
    });
  }

  const from = (params.page - 1) * params.limit;
  const sortField = params.tab === 'scheduled' ? 'scheduled_at' : 'sent_at';
  const sortOrder = params.tab === 'scheduled' ? 'asc' : 'desc';

  try {
    const result = await esClient.search<EmailSearchDoc>({
      index: env.ELASTICSEARCH_INDEX,
      from,
      size: params.limit,
      track_total_hits: true,
      query: {
        bool: {
          filter: filters,
          ...(mustClauses.length > 0 ? { must: mustClauses } : {}),
        },
      },
      sort: [
        { [sortField]: { order: sortOrder, missing: '_last' } },
        { created_at: { order: 'desc' } },
      ],
    });

    const totalRaw = result.hits.total;
    const total = typeof totalRaw === 'number' ? totalRaw : totalRaw?.value ?? 0;
    const hitIds = result.hits.hits
      .map((h) => h._id)
      .filter((id): id is string => typeof id === 'string');

    if (hitIds.length === 0) {
      return { emails: [], total, searchEngine: 'elasticsearch' };
    }

    const { rows } = await query<EmailRow>(
      `SELECT * FROM emails WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [params.userId, hitIds]
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = hitIds.map((id) => byId.get(id)).filter((r): r is EmailRow => Boolean(r));
    return { emails: ordered, total, searchEngine: 'elasticsearch' };
  } catch (err) {
    console.warn('[Elasticsearch] Query failed, falling back to PostgreSQL:', err instanceof Error ? err.message : err);
    return fallbackPostgresSearch(params, allowedStatuses);
  }
}

async function fallbackPostgresSearch(
  params: SearchEmailsParams,
  allowedStatuses: EmailStatus[]
): Promise<{
  emails: EmailRow[];
  total: number;
  searchEngine: 'postgresql_fallback';
}> {
  const values: unknown[] = [params.userId, allowedStatuses];
  const conditions = ['user_id = $1', 'is_archived = FALSE', 'status = ANY($2::text[])'];

  if (params.senderId) {
    values.push(params.senderId);
    conditions.push(`sender_id = $${values.length}`);
  }
  if (params.starredOnly) {
    conditions.push('is_starred = TRUE');
  }
  if (params.queryText?.trim()) {
    values.push(`%${params.queryText.trim()}%`);
    const idx = values.length;
    conditions.push(
      `(recipient_email ILIKE $${idx} OR subject ILIKE $${idx} OR body_text ILIKE $${idx} OR sender_email ILIKE $${idx})`
    );
  }

  const whereSql = conditions.join(' AND ');
  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM emails WHERE ${whereSql}`,
    values
  );
  const total = Number(countRes.rows[0]?.count ?? '0');

  const orderBy =
    params.tab === 'scheduled'
      ? 'scheduled_at ASC, created_at DESC'
      : 'COALESCE(sent_at, failed_at, created_at) DESC';

  const offset = (params.page - 1) * params.limit;
  values.push(params.limit, offset);
  const { rows } = await query<EmailRow>(
    `SELECT * FROM emails WHERE ${whereSql} ORDER BY ${orderBy} LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return { emails: rows, total, searchEngine: 'postgresql_fallback' };
}

export async function reindexAllEmailsFromDb(): Promise<number> {
  const { rows } = await query<EmailRow>('SELECT * FROM emails ORDER BY created_at ASC');
  await bulkIndexEmailDocuments(rows);
  return rows.length;
}
