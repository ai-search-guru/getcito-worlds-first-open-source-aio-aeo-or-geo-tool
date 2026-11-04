/**
 * Cities a prompt can be tracked in (PROMPT-015d). A city is the location
 * code `<country>~<CITY>` (`TR~ISTANBUL`). Only the engines that can ask
 * from a city run there: Google AI Overview and AI Mode, with Google's
 * canonical name as the provider's `location`, and the API models, with
 * `user_location.city`. The other engines answer per country, so a city
 * code is skipped for them (locations.js).
 *
 * The web keeps the same ids and countries in `frontend/src/config/cities.ts`;
 * both lists must change together.
 *
 * - `name`, `region`: what the API models' `user_location` takes.
 * - `google`: Google's canonical location name, as Google Ads geotargets
 *   spell it.
 */
/**
 * Türkiye as Google's geotargets spell it, in ASCII: Google renamed it from
 * Turkey. Still to be confirmed with a real request; if Google reads it
 * otherwise, this line is the only one to change.
 */
const GOOGLE_TURKIYE = 'Turkiye';

export const CITIES = [
  {
    country: 'US',
    id: 'NEW_YORK',
    name: 'New York',
    region: 'New York',
    google: 'New York,New York,United States',
  },
  {
    country: 'US',
    id: 'LOS_ANGELES',
    name: 'Los Angeles',
    region: 'California',
    google: 'Los Angeles,California,United States',
  },
  {
    country: 'US',
    id: 'CHICAGO',
    name: 'Chicago',
    region: 'Illinois',
    google: 'Chicago,Illinois,United States',
  },
  {
    country: 'US',
    id: 'HOUSTON',
    name: 'Houston',
    region: 'Texas',
    google: 'Houston,Texas,United States',
  },
  {
    country: 'US',
    id: 'SAN_FRANCISCO',
    name: 'San Francisco',
    region: 'California',
    google: 'San Francisco,California,United States',
  },
  {
    country: 'US',
    id: 'MIAMI',
    name: 'Miami',
    region: 'Florida',
    google: 'Miami,Florida,United States',
  },
  {
    country: 'US',
    id: 'SEATTLE',
    name: 'Seattle',
    region: 'Washington',
    google: 'Seattle,Washington,United States',
  },
  {
    country: 'US',
    id: 'BOSTON',
    name: 'Boston',
    region: 'Massachusetts',
    google: 'Boston,Massachusetts,United States',
  },
  {
    country: 'US',
    id: 'AUSTIN',
    name: 'Austin',
    region: 'Texas',
    google: 'Austin,Texas,United States',
  },
  {
    country: 'US',
    id: 'ATLANTA',
    name: 'Atlanta',
    region: 'Georgia',
    google: 'Atlanta,Georgia,United States',
  },
  {
    country: 'GB',
    id: 'LONDON',
    name: 'London',
    region: 'England',
    google: 'London,England,United Kingdom',
  },
  {
    country: 'GB',
    id: 'MANCHESTER',
    name: 'Manchester',
    region: 'England',
    google: 'Manchester,England,United Kingdom',
  },
  {
    country: 'GB',
    id: 'BIRMINGHAM',
    name: 'Birmingham',
    region: 'England',
    google: 'Birmingham,England,United Kingdom',
  },
  {
    country: 'GB',
    id: 'EDINBURGH',
    name: 'Edinburgh',
    region: 'Scotland',
    google: 'Edinburgh,Scotland,United Kingdom',
  },
  {
    country: 'DE',
    id: 'BERLIN',
    name: 'Berlin',
    region: 'Berlin',
    google: 'Berlin,Berlin,Germany',
  },
  {
    country: 'DE',
    id: 'MUNICH',
    name: 'Munich',
    region: 'Bavaria',
    google: 'Munich,Bavaria,Germany',
  },
  {
    country: 'DE',
    id: 'HAMBURG',
    name: 'Hamburg',
    region: 'Hamburg',
    google: 'Hamburg,Hamburg,Germany',
  },
  {
    country: 'DE',
    id: 'FRANKFURT',
    name: 'Frankfurt',
    region: 'Hesse',
    google: 'Frankfurt,Hesse,Germany',
  },
  {
    country: 'DE',
    id: 'COLOGNE',
    name: 'Cologne',
    region: 'North Rhine-Westphalia',
    google: 'Cologne,North Rhine-Westphalia,Germany',
  },
  {
    country: 'FR',
    id: 'PARIS',
    name: 'Paris',
    region: 'Ile-de-France',
    google: 'Paris,Ile-de-France,France',
  },
  {
    country: 'FR',
    id: 'LYON',
    name: 'Lyon',
    region: 'Auvergne-Rhone-Alpes',
    google: 'Lyon,Auvergne-Rhone-Alpes,France',
  },
  {
    country: 'FR',
    id: 'MARSEILLE',
    name: 'Marseille',
    region: "Provence-Alpes-Cote d'Azur",
    google: "Marseille,Provence-Alpes-Cote d'Azur,France",
  },
  {
    country: 'TR',
    id: 'ISTANBUL',
    name: 'Istanbul',
    region: 'Istanbul',
    google: `Istanbul,Istanbul,${GOOGLE_TURKIYE}`,
  },
  {
    country: 'TR',
    id: 'ANKARA',
    name: 'Ankara',
    region: 'Ankara',
    google: `Ankara,Ankara,${GOOGLE_TURKIYE}`,
  },
  {
    country: 'TR',
    id: 'IZMIR',
    name: 'Izmir',
    region: 'Izmir',
    google: `Izmir,Izmir,${GOOGLE_TURKIYE}`,
  },
  {
    country: 'TR',
    id: 'BURSA',
    name: 'Bursa',
    region: 'Bursa',
    google: `Bursa,Bursa,${GOOGLE_TURKIYE}`,
  },
  {
    country: 'TR',
    id: 'ANTALYA',
    name: 'Antalya',
    region: 'Antalya',
    google: `Antalya,Antalya,${GOOGLE_TURKIYE}`,
  },
  { country: 'JP', id: 'TOKYO', name: 'Tokyo', region: 'Tokyo', google: 'Tokyo,Tokyo,Japan' },
  { country: 'JP', id: 'OSAKA', name: 'Osaka', region: 'Osaka', google: 'Osaka,Osaka,Japan' },
  {
    country: 'BR',
    id: 'SAO_PAULO',
    name: 'Sao Paulo',
    region: 'State of Sao Paulo',
    google: 'Sao Paulo,State of Sao Paulo,Brazil',
  },
  {
    country: 'BR',
    id: 'RIO_DE_JANEIRO',
    name: 'Rio de Janeiro',
    region: 'State of Rio de Janeiro',
    google: 'Rio de Janeiro,State of Rio de Janeiro,Brazil',
  },
  {
    country: 'IN',
    id: 'MUMBAI',
    name: 'Mumbai',
    region: 'Maharashtra',
    google: 'Mumbai,Maharashtra,India',
  },
  {
    country: 'IN',
    id: 'NEW_DELHI',
    name: 'New Delhi',
    region: 'Delhi',
    google: 'New Delhi,Delhi,India',
  },
  {
    country: 'IN',
    id: 'BENGALURU',
    name: 'Bengaluru',
    region: 'Karnataka',
    google: 'Bengaluru,Karnataka,India',
  },
  {
    country: 'AU',
    id: 'SYDNEY',
    name: 'Sydney',
    region: 'New South Wales',
    google: 'Sydney,New South Wales,Australia',
  },
  {
    country: 'AU',
    id: 'MELBOURNE',
    name: 'Melbourne',
    region: 'Victoria',
    google: 'Melbourne,Victoria,Australia',
  },
  {
    country: 'CA',
    id: 'TORONTO',
    name: 'Toronto',
    region: 'Ontario',
    google: 'Toronto,Ontario,Canada',
  },
  {
    country: 'CA',
    id: 'VANCOUVER',
    name: 'Vancouver',
    region: 'British Columbia',
    google: 'Vancouver,British Columbia,Canada',
  },
  {
    country: 'CA',
    id: 'MONTREAL',
    name: 'Montreal',
    region: 'Quebec',
    google: 'Montreal,Quebec,Canada',
  },
  {
    country: 'NL',
    id: 'AMSTERDAM',
    name: 'Amsterdam',
    region: 'North Holland',
    google: 'Amsterdam,North Holland,Netherlands',
  },
  {
    country: 'NL',
    id: 'ROTTERDAM',
    name: 'Rotterdam',
    region: 'South Holland',
    google: 'Rotterdam,South Holland,Netherlands',
  },
  { country: 'IT', id: 'ROME', name: 'Rome', region: 'Lazio', google: 'Rome,Lazio,Italy' },
  { country: 'IT', id: 'MILAN', name: 'Milan', region: 'Lombardy', google: 'Milan,Lombardy,Italy' },
  {
    country: 'ES',
    id: 'MADRID',
    name: 'Madrid',
    region: 'Community of Madrid',
    google: 'Madrid,Community of Madrid,Spain',
  },
  {
    country: 'ES',
    id: 'BARCELONA',
    name: 'Barcelona',
    region: 'Catalonia',
    google: 'Barcelona,Catalonia,Spain',
  },
  { country: 'KR', id: 'SEOUL', name: 'Seoul', region: 'Seoul', google: 'Seoul,Seoul,South Korea' },
  {
    country: 'SE',
    id: 'STOCKHOLM',
    name: 'Stockholm',
    region: 'Stockholm County',
    google: 'Stockholm,Stockholm County,Sweden',
  },
  {
    country: 'MX',
    id: 'MEXICO_CITY',
    name: 'Mexico City',
    region: 'Mexico City',
    google: 'Mexico City,Mexico City,Mexico',
  },
  {
    country: 'SG',
    id: 'SINGAPORE',
    name: 'Singapore',
    region: 'Singapore',
    google: 'Singapore,Singapore',
  },
  {
    country: 'AE',
    id: 'DUBAI',
    name: 'Dubai',
    region: 'Dubai',
    google: 'Dubai,Dubai,United Arab Emirates',
  },
  {
    country: 'AE',
    id: 'ABU_DHABI',
    name: 'Abu Dhabi',
    region: 'Abu Dhabi',
    google: 'Abu Dhabi,Abu Dhabi,United Arab Emirates',
  },
];

const BY_CODE = new Map(CITIES.map((c) => [`${c.country}~${c.id}`, c]));

/** The city a code names (`TR~ISTANBUL`), or null. */
export function cityFor(code) {
  return (
    BY_CODE.get(
      String(code ?? '')
        .trim()
        .toUpperCase(),
    ) ?? null
  );
}
