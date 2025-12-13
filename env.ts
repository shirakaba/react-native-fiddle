import * as path from 'node:path';

export function sourceEnvVars() {
  const envFilePath = path.resolve(__dirname, './.env');
  try {
    process.loadEnvFile(envFilePath);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}
