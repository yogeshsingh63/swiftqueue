export interface JobPayload {
  id: string;
  type: 'email' | 'report' | 'image';
  payload: any;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  forceFail?: boolean;
}

/**
 * Helper to simulate a delay in execution
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Main processor function to run a job based on its type
 */
export async function processJob(job: JobPayload, workerId: string): Promise<void> {
  console.log(`[Worker ${workerId}] Starting Job ${job.id.substring(0, 8)} (${job.type})`);

  if (job.forceFail) {
    await delay(500); // Small delay to feel realistic
    throw new Error('Forced failure for testing/DLQ demonstration.');
  }

  switch (job.type) {
    case 'email':
      // Email takes 2 seconds
      await delay(2000);
      console.log(`[Worker ${workerId}] Sent email to ${job.payload.to}`);
      break;

    case 'report':
      // Report Generation takes 4 seconds
      await delay(4000);
      console.log(`[Worker ${workerId}] Generated PDF report #${job.payload.reportId}`);
      break;

    case 'image':
      // Image Processing takes 3 seconds
      await delay(3000);
      console.log(`[Worker ${workerId}] Resized image ${job.payload.imageUrl} to ${job.payload.resizeWidth}px`);
      break;

    default:
      await delay(1000);
      console.log(`[Worker ${workerId}] Processed unknown job type ${job.type}`);
  }
}
