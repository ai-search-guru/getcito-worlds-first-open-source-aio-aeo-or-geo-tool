/**
 * Who asks for a report card, and for which site (REPORT-CARD §3): a work
 * e-mail, never a free one; the company's website, which must be the
 * e-mail's own domain or share it (shop.acme.com and acme.com), so nobody
 * can ask for someone else's site; and a LinkedIn profile.
 */

/**
 * Free and throwaway mail providers, under any of their country domains
 * (hotmail.co.uk, yahoo.com.tr): names no company uses for its own mail.
 */
const FREE_PROVIDERS = [
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'msn',
  'windowslive',
  'yahoo',
  'ymail',
  'rocketmail',
  'aol',
  'yandex',
  'proton',
  'protonmail',
  'gmx',
  'mail',
  'zohomail',
  'tutanota',
  'tuta',
  'yopmail',
  'mailinator',
  'guerrillamail',
  'sharklasers',
  'temp-mail',
  'tempmail',
  '10minutemail',
  'trashmail',
  'getnada',
  'dispostable',
  'maildrop',
];
/**
 * Free mail at a provider whose name is also a company's (AT&T, Orange,
 * Verizon): only its consumer domain, so the company's own staff can ask.
 */
const FREE_DOMAINS = new Set([
  'icloud.com',
  'me.com',
  'mac.com',
  'ya.ru',
  'pm.me',
  'bk.ru',
  'list.ru',
  'inbox.ru',
  'internet.ru',
  'rambler.ru',
  'ukr.net',
  'abv.bg',
  'seznam.cz',
  'wp.pl',
  'o2.pl',
  'onet.pl',
  'interia.pl',
  'web.de',
  't-online.de',
  'freenet.de',
  'libero.it',
  'virgilio.it',
  'orange.fr',
  'wanadoo.fr',
  'sfr.fr',
  'free.fr',
  'laposte.net',
  'bluewin.ch',
  'superonline.com',
  'ttmail.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'naver.com',
  'hanmail.net',
  'daum.net',
  'rediffmail.com',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'verizon.net',
  'comcast.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'juno.com',
  'netzero.net',
  'shaw.ca',
  'sympatico.ca',
  'bigpond.com',
  'hushmail.com',
  'fastmail.com',
  'hey.com',
  'zoho.com',
]);

/** A provider's name with only a country or generic ending after it: "hotmail.co.uk". */
const FREE_PATTERN = new RegExp(
  `^(${FREE_PROVIDERS.map((p) => p.replace(/[-.]/g, '\\$&')).join('|')})\\.(com|net|org|co|[a-z]{2})(\\.[a-z]{2})?$`,
);

/** The domain of an e-mail address, lower case; null for one without a plain domain. */
export function emailDomain(email) {
  const match = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(String(email ?? '').trim());
  return match ? match[1].toLowerCase().replace(/\.$/, '') : null;
}

/** Whether the e-mail is at a free or throwaway provider. */
export function isFreeEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return FREE_DOMAINS.has(domain) || FREE_PATTERN.test(domain);
}

/**
 * A website as typed ("https://www.Acme.com/about"), as the host the card
 * measures: lower case, without "www.", the scheme, a port or a path; null
 * for one that isn't a plain public host name.
 */
export function websiteHost(website) {
  let text = String(website ?? '').trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let host;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    host = url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    ? host
    : null;
}

/**
 * Whether the website belongs to the e-mail's company: the same domain, or
 * one inside the other (shop.acme.com for acme.com, acme.com for
 * uk.acme.com).
 */
export function siteMatchesEmail(host, domain) {
  if (!host || !domain) return false;
  const bare = domain.replace(/^www\./, '');
  return host === bare || host.endsWith(`.${bare}`) || bare.endsWith(`.${host}`);
}

/**
 * A LinkedIn profile's address as kept: https://www.linkedin.com/in/{name},
 * from any of the ways it is pasted; null when it isn't a profile.
 */
export function linkedinProfile(value) {
  const match =
    /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#\s]{2,100})\/?(?:[?#].*)?$/i.exec(
      String(value ?? '').trim(),
    );
  return match ? `https://www.linkedin.com/in/${match[1]}` : null;
}
