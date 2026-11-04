'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';

import { CITIES } from '@/config/cities';
import { TRACKING_COUNTRIES, US_STATES } from '@/config/promptOptions';
import {
  cityCode,
  formatRegionDisplay,
  locationCode,
  locationSearchText,
  parseLocation,
  regionLabel,
} from '@/lib/region';
import { useTrackingCountries } from '@/lib/useTrackingCountries';
import { CITY_MODELS, ENGINE_LABELS, countryName, missingEngines } from '@/lib/trackingCountries';
import { Badge } from '@/components/ui/badge';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';

interface LocationOption {
  value: string;
  /** What base-ui filters the search box against. */
  label: string;
  sublabel: string;
}

export interface LocationPickerProps {
  value: string[];
  onChange: (locations: string[]) => void;
  /**
   * Most locations this prompt may hold before the org hits its plan cap —
   * null when the plan is unlimited. The caller derives it from org usage so
   * the picker can refuse a pick with a reason instead of letting the save
   * fail afterwards.
   */
  maxSelectable: number | null;
  /** Field label. Defaults to the per-prompt wording. */
  label?: string;
  /** What the count describes, when the plan is unlimited. */
  countNoun?: string;
  /**
   * Allow clearing every chip. A prompt must keep at least one location — it
   * cannot be tracked otherwise — but a picker used to CHOOSE locations (the
   * bulk dialog) has no such floor.
   */
  allowEmpty?: boolean;
}

/** The brand regions first, as people look for them, then every other country by name. */
const POPULAR = TRACKING_COUNTRIES.slice(0, 18).map((c) => c.code);

/**
 * Per-prompt tracking locations (#691).
 *
 * Follows the card's existing "add, then chip" idiom (the Platform & Models
 * picker): the list adds, the chips below remove. It is a Combobox rather
 * than a Select because the list is about 50 countries plus 50 states — long
 * enough that scrolling to a known name is worse than typing it.
 *
 * One thing this picker must say out loud, because it costs money if left
 * implicit: every location is a plan-quota unit (the trigger carries the
 * count, and picks stop at the cap with the reason on screen).
 */
export function LocationPicker({
  value,
  onChange,
  maxSelectable,
  label = 'Locations',
  countNoun = 'tracked',
  allowEmpty = false,
}: LocationPickerProps) {
  // The countries the engines answer from, as the API last read them; until
  // then, or without a read, the picker's own list (PROMPT-015e).
  const engineCountries = useTrackingCountries();
  const options = useMemo<LocationOption[]>(() => {
    const read = engineCountries?.length ? engineCountries : null;
    const countries = read
      ? [...read]
          .sort(
            (a, b) =>
              (POPULAR.includes(a.code) ? POPULAR.indexOf(a.code) : 99) -
                (POPULAR.includes(b.code) ? POPULAR.indexOf(b.code) : 99) ||
              countryName(a.code).localeCompare(countryName(b.code)),
          )
          .map((country) => {
            const missing = missingEngines(country, read).map((m) => ENGINE_LABELS[m] ?? m);
            return {
              value: country.code,
              // Found by its other names too: "Turkey" or "Turkiye" finds Türkiye.
              label: locationSearchText(country.code),
              sublabel: missing.length ? `Country · not on ${missing.join(', ')}` : 'Country',
            };
          })
      : TRACKING_COUNTRIES.map((region) => ({
          value: region.code,
          label: locationSearchText(region.code),
          sublabel: 'Country',
        }));
    // A city only where Google's engines answer from its country.
    const cityCountries = read
      ? new Set(read.filter((c) => c.models.some((m) => CITY_MODELS.has(m))).map((c) => c.code))
      : null;
    return [
      ...countries,
      ...US_STATES.map((state) => ({
        value: locationCode('US', state.code),
        label: state.label,
        sublabel: 'United States · state',
      })),
      // Cities (PROMPT-015d): asked by Google's engines and the API models.
      ...CITIES.filter((city) => !cityCountries || cityCountries.has(city.country)).map((city) => ({
        value: cityCode(city.country, city.id),
        // Found typed with or without its marks, or by its country: "Ist" finds
        // İstanbul, "Sao" São Paulo, "Turkey" every city in Türkiye.
        label: locationSearchText(cityCode(city.country, city.id)),
        sublabel: `City · ${regionLabel(city.country)}`,
      })),
    ];
  }, [engineCountries]);

  const selected = new Set(value);
  const atCap = maxSelectable !== null && value.length >= maxSelectable;

  // A prompt with no location cannot be tracked, so the last chip keeps its
  // remove control hidden rather than failing server-side.
  const canRemove = allowEmpty || value.length > 1;

  const hasCityPick = value.some((code) => parseLocation(code)?.city);

  const add = (option: LocationOption | null) => {
    if (!option || selected.has(option.value) || atCap) return;
    onChange([...value, option.value]);
  };

  const remove = (code: string) => {
    if (!canRemove) return;
    onChange(value.filter((entry) => entry !== code));
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        <span className="ml-1 font-normal">
          {maxSelectable === null
            ? `· ${value.length} ${countNoun}`
            : `· ${value.length} of ${maxSelectable} available`}
        </span>
      </label>

      <Combobox items={options} value={null} onValueChange={add}>
        <ComboboxTrigger className="w-full">
          <span className="truncate text-muted-foreground">
            {atCap ? 'Plan limit reached' : 'Add a country, US state or city'}
          </span>
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput placeholder="Search locations…" />
          <ComboboxList>
            <ComboboxEmpty>No locations match.</ComboboxEmpty>
            <ComboboxCollection>
              {(option: LocationOption) => (
                <ComboboxItem
                  key={option.value}
                  value={option}
                  disabled={selected.has(option.value) || atCap}
                >
                  <div>
                    <div>{formatRegionDisplay(option.value)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {selected.has(option.value)
                        ? `Already ${countNoun}`
                        : atCap
                          ? 'Plan limit reached — remove a location or upgrade'
                          : option.sublabel}
                    </div>
                  </div>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.map((code) => (
            <Badge key={code} variant="outline" className="gap-1 text-xs">
              {formatRegionDisplay(code)}
              {canRemove && (
                <button type="button" onClick={() => remove(code)} aria-label={`Remove ${code}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {hasCityPick && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          A city is asked by Google AI Mode, AI Overview and the API models. ChatGPT, Perplexity,
          Copilot, Gemini and Grok answer per country, so track the country too to see them.
        </p>
      )}
    </div>
  );
}
