import { loadConfig } from '../config/app-config';
import { StorageService } from './storage.service';

describe('StorageService (S3)', () => {
  const env = process.env;
  beforeAll(() => {
    // credenciais fictícias: a assinatura do link é calculada localmente, sem chamar a AWS
    process.env = { ...env, AWS_ACCESS_KEY_ID: 'AKIATESTE', AWS_SECRET_ACCESS_KEY: 'segredo-teste', AWS_REGION: 'sa-east-1' };
  });
  afterAll(() => {
    process.env = env;
  });

  const storage = () =>
    new StorageService(
      loadConfig({
        PORTAL_JWT_SECRET: 'x'.repeat(40),
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'portal-apps-hml',
        ALLOWED_SOURCE_BUCKETS: 'bucket-antigo, outro-bucket',
      }),
    );

  it('assina link do bucket do portal com validade curta e nome do arquivo', async () => {
    const target = await storage().downloadTarget('dta/imonitor-dta/1.0.0/imonitor-dta-1.0.0.apk', 'imonitor-dta-1.0.0.apk');
    expect(target.kind).toBe('redirect');
    const url = new URL((target as { url: string }).url);
    expect(url.hostname).toContain('portal-apps-hml');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toContain('imonitor-dta-1.0.0.apk');
  });

  it('assina link de APK reaproveitado de outro bucket liberado', async () => {
    const target = await storage().downloadTarget('apps/imonitor.apk', 'imonitor-2.8.1.apk', 'bucket-antigo');
    expect(new URL((target as { url: string }).url).hostname).toContain('bucket-antigo');
  });

  it('recusa bucket fora de ALLOWED_SOURCE_BUCKETS', async () => {
    await expect(storage().downloadTarget('apps/x.apk', 'x.apk', 'bucket-qualquer')).rejects.toThrow(/não liberado/);
  });
});
