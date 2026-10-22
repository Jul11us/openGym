import { env } from 'cloudflare:workers';
import { handleGymApi } from '../../../lib/gym-api';

export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return handleGymApi(request, env);
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
