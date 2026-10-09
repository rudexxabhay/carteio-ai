import { ResendEmailProvider } from '../src/modules/auth/email.service';

describe('Resend transactional email provider', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.AUTH_EMAIL_FROM;
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.AUTH_EMAIL_FROM; else process.env.AUTH_EMAIL_FROM = originalFrom;
  });

  it('posts the transactional payload and accepts only a provider message id', async () => {
    process.env.RESEND_API_KEY = 'test-only-key';
    process.env.AUTH_EMAIL_FROM = 'Carteio AI <no-reply@mail.carteio.in>';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ id: 'email-test-id' }) } as Response);
    expect(await new ResendEmailProvider().send('person@example.com', 'Test subject', 'Test body')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST', headers: { Authorization: 'Bearer test-only-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Carteio AI <no-reply@mail.carteio.in>', to: ['person@example.com'], subject: 'Test subject', text: 'Test body' }),
    }));
  });

  it('does not accept provider rejection or malformed success responses', async () => {
    process.env.RESEND_API_KEY = 'test-only-key'; process.env.AUTH_EMAIL_FROM = 'Carteio AI <no-reply@mail.carteio.in>';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 422, headers: new Headers(), json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) } as Response);
    const provider = new ResendEmailProvider();
    await expect(provider.send('person@example.com', 'subject', 'body')).resolves.toBe(false);
    await expect(provider.send('person@example.com', 'subject', 'body')).resolves.toBe(false);
  });
});
