import { describe, expect, it } from 'vitest';
import {
  emailDomain,
  isFreeEmail,
  linkedinProfile,
  siteMatchesEmail,
  websiteHost,
} from './identity.js';

describe('isFreeEmail', () => {
  it('refuses free and throwaway mail, under any country domain', () => {
    for (const email of [
      'ayse@gmail.com',
      'AYSE@Hotmail.co.uk',
      'a@outlook.com.tr',
      'a@yahoo.com.tr',
      'a@yandex.ru',
      'a@icloud.com',
      'a@proton.me',
      'a@protonmail.com',
      'a@gmx.de',
      'a@mail.ru',
      'a@yopmail.com',
      'a@orange.fr',
      'a@att.net',
    ]) {
      expect(isFreeEmail(email), email).toBe(true);
    }
  });

  it('takes a company’s own mail, the mail providers’ companies too', () => {
    for (const email of [
      'ayse@acme.com',
      'alex@getcito.com',
      'a@mail.acme.com',
      'a@att.com',
      'a@orange.com',
      'a@microsoft.com',
      'a@livenation.com',
      'a@gmailify.example',
    ]) {
      expect(isFreeEmail(email), email).toBe(false);
    }
  });
});

describe('emailDomain', () => {
  it('is the domain in lower case, or null', () => {
    expect(emailDomain(' Ayse@Acme.COM ')).toBe('acme.com');
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain('a@localhost')).toBeNull();
  });
});

describe('websiteHost', () => {
  it('keeps the host, without www, the scheme, a port or a path', () => {
    expect(websiteHost('https://www.Acme.com/about?x=1')).toBe('acme.com');
    expect(websiteHost('acme.com')).toBe('acme.com');
    expect(websiteHost('shop.acme.com.tr/')).toBe('shop.acme.com.tr');
    expect(websiteHost('http://acme.com:8080')).toBe('acme.com');
  });

  it('refuses what isn’t a public host name', () => {
    for (const value of [
      '',
      'localhost',
      'ftp://acme.com',
      'https://user:pw@acme.com',
      '10.0.0.1',
      'acme',
    ]) {
      expect(websiteHost(value), value).toBeNull();
    }
  });
});

describe('siteMatchesEmail', () => {
  it('takes the e-mail’s domain and its subdomains, either way round', () => {
    expect(siteMatchesEmail('acme.com', 'acme.com')).toBe(true);
    expect(siteMatchesEmail('shop.acme.com', 'acme.com')).toBe(true);
    expect(siteMatchesEmail('acme.com', 'uk.acme.com')).toBe(true);
  });

  it('refuses another company’s site', () => {
    expect(siteMatchesEmail('competitor.com', 'acme.com')).toBe(false);
    expect(siteMatchesEmail('notacme.com', 'acme.com')).toBe(false);
    expect(siteMatchesEmail('acme.com.evil.example', 'acme.com')).toBe(false);
    expect(siteMatchesEmail(null, 'acme.com')).toBe(false);
  });
});

describe('linkedinProfile', () => {
  it('keeps a profile as one address', () => {
    expect(linkedinProfile('linkedin.com/in/ayse-yilmaz')).toBe(
      'https://www.linkedin.com/in/ayse-yilmaz',
    );
    expect(linkedinProfile('https://tr.linkedin.com/in/ayse-yilmaz/?trk=x')).toBe(
      'https://www.linkedin.com/in/ayse-yilmaz',
    );
  });

  it('refuses a company page or another site', () => {
    expect(linkedinProfile('https://www.linkedin.com/company/acme')).toBeNull();
    expect(linkedinProfile('https://linkedin.com.evil.example/in/x')).toBeNull();
    expect(linkedinProfile('')).toBeNull();
  });
});
