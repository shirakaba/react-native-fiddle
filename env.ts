import * as path from 'node:path';

export function sourceEnvVars() {
  const envFilePath = path.resolve(__dirname, './.env');
  process.loadEnvFile(envFilePath);
}
