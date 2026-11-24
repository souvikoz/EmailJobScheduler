import { Client } from '@elastic/elasticsearch';
import { env } from './env.js';

export const esClient = new Client({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 10000,
});

export async function ensureEmailIndex(): Promise<void> {
  const exists = await esClient.indices.exists({ index: env.ELASTICSEARCH_INDEX });
  if (exists) return;

  await esClient.indices.create({
    index: env.ELASTICSEARCH_INDEX,
    mappings: {
      properties: {
        id: { type: 'keyword' },
        user_id: { type: 'keyword' },
        campaign_id: { type: 'keyword' },
        sender_id: { type: 'keyword' },
        sender_email: {
          type: 'text',
          fields: { keyword: { type: 'keyword' } },
        },
        sender_name: { type: 'text' },
        recipient_email: {
          type: 'text',
          fields: { keyword: { type: 'keyword' } },
        },
        subject: { type: 'text' },
        body_text: { type: 'text' },
        status: { type: 'keyword' },
        scheduled_at: { type: 'date' },
        sent_at: { type: 'date' },
        failed_at: { type: 'date' },
        ethereal_preview_url: { type: 'keyword' },
        is_starred: { type: 'boolean' },
        is_archived: { type: 'boolean' },
        created_at: { type: 'date' },
      },
    },
  });
  console.log(`[Elasticsearch] Created index: ${env.ELASTICSEARCH_INDEX}`);
}

export async function checkElasticsearchHealth(): Promise<boolean> {
  const health = await esClient.cluster.health();
  return health.status === 'green' || health.status === 'yellow';
}
