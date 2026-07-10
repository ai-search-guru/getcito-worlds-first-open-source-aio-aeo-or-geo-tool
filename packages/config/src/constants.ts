/**
 * Shared constants used across all deployment configurations
 */

/**
 * Default branding values for local/demo modes
 * These are used when environment variables are not set
 * 
 * NOTE: Whitelabel mode does NOT use these defaults - all values must be
 * provided via environment variables.
 */
export const DEFAULT_APP_NAME = "Getcito";
export const DEFAULT_APP_ICON = "/icons/getcito-icon.svg";
export const DEFAULT_APP_URL = "http://localhost:3000/";

/**
 * Getcito brand constants — used for icon generation, manifest, and the brand kit.
 */
export const Getcito_BRAND_COLOR = "#2563eb"; // blue-600
export const Getcito_BRAND_FONT = "Titan One";
export const Getcito_THEME_COLOR = "#2563eb";
export const Getcito_BACKGROUND_COLOR = "#ffffff";

/**
 * Default chart colors for the Getcito product.
 *
 * 11 base hues (Observable + Tableau, anchored to brand blue) expanded
 * into 55 colors across five lightness tiers: base → dark → light →
 * muted → deep. This keeps harmony (same hue families throughout) while
 * supporting charts with many series. Whitelabel deployments override
 * via VITE_CHART_COLORS.
 */
export const DEFAULT_CHART_COLORS = [
  // Base
  "#2563eb", "#efb118", "#3ca951", "#ff725c", "#a463f2",
  "#ff8ab7", "#38b2ac", "#9c6b4e", "#7cb342", "#b07aa1",
  "#9498a0",
  // Dark
  "#0b43bc", "#bb8807", "#247a35", "#f9381a", "#7c1af4",
  "#fa478c", "#22817c", "#714932", "#58842a", "#934d7f",
  "#5e6d8d",
  // Light
  "#6d94e8", "#ebc566", "#6fbe7f", "#f88877", "#b282ed",
  "#f877a9", "#6ec4c0", "#b09382", "#9fc17b", "#c6a9be",
  "#a9b3c6",
  // Muted
  "#5178cd", "#d0aa49", "#62936c", "#ea8e80", "#ae87de",
  "#eb84ac", "#5f9b98", "#967664", "#839b69", "#af88a4",
  "#8e9ab4",
  // Deep
  "#0e3486", "#84620b", "#1e5229", "#db2206", "#6513c9",
  "#f9156d", "#1c5451", "#493327", "#3e5822", "#6b435f",
  "#49566e",
];
