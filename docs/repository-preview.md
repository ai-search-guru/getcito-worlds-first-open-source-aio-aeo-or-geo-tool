# Repository presentation

The README uses local GetCito assets. No remote badges, counters, or image-generation service is required to display them.

| Asset                                         | Purpose                                     |
| --------------------------------------------- | ------------------------------------------- |
| [README banner](images/readme-banner.png)     | 1600 × 560 header with AI platform logos    |
| [Social preview](images/social-preview.png)   | 1280 × 640 image for shared GitHub links    |
| [GitHub avatar](images/github-avatar.png)     | 512 × 512 GetCito G profile picture         |
| [Light dashboard](images/dashboard-light.png) | Sample dashboard preview in the light theme |
| [Dark dashboard](images/dashboard-dark.png)   | Sample dashboard preview in the dark theme  |

The dashboard images are captures of the application's `DashboardPreview` component with sample GetCito content. Metric bars are placeholders, not measured results. They were captured from an offline component preview, not an authenticated production dashboard.

The banners reuse the GetCito wordmark and local AI platform logos. Their pale lime background, teal `#16404b`, lime `#e2ff5e`, and PolySans typography follow the getcito.com homepage hero. The headline reads “Check your AI visibility. Get cited.” with only “Get cited.” highlighted. The badge has an outlined pill shape with no fill, and the smaller platform logos have no captions or card backgrounds. The social preview is opaque and below GitHub's 1 MB limit.

## Configure the GitHub preview

Committing an image or placing it in the README does **not** set the repository's social preview. A repository administrator must upload it separately:

1. Open [repository settings](https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/settings).
2. Find **Social preview → Edit → Upload an image**.
3. Upload [social-preview.png](images/social-preview.png).

GitHub recommends **1280 × 640 pixels**, under **1 MB**, in PNG, JPG, or GIF format. See [GitHub's social-preview documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

This image is for shared repository links. It does not control every GitHub search or repository-listing layout.

## Set the GitHub avatar

Upload [github-avatar.png](images/github-avatar.png) through your GitHub account or organization's profile-picture settings. It uses the existing white GetCito G and lime sparkle on deep teal, with padding for a circular crop. The PNG is 512 × 512 pixels with an opaque background.

The avatar is a separate account or organization setting; adding it to the repository does not change the profile picture.

## Suggested About details

Use the repository's **About** settings for its description, website, and topics:

- **Description:** Check your AI visibility. Get cited. Open-source AIO, AEO, and GEO tools for tracking brand mentions, citations, and competitors, with content workflows and site audits.
- **Website:** `https://getcito.com`
- **Topics:** `aio`, `aeo`, `geo`, `ai-visibility`, `ai-search`, `self-hosted`, `nextjs`, `supabase`

These are suggested settings; changing this file does not update GitHub metadata.
