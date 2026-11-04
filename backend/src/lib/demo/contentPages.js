/**
 * The demo's three Content Editor drafts, as their pages read: one the
 * Content Agent wrote from an opportunity, one page being optimized, one
 * published. Made up like everything in the demo (brewline.js): Brewline
 * Coffee and its products don't exist, and every link stays on `.example`.
 */

export const DRAFTS = [
  {
    key: 'low-acid-guide',
    opportunity: 'sensitive-stomach',
    prompts: ['low-acid'],
    title: 'Low-Acid Coffee: How to Choose Beans That Are Gentle on Your Stomach',
    pageType: 'buying_guide',
    method: 'create',
    status: 'draft',
    author: 'agent',
    created: [8, 4],
    updated: [9, 0.5],
    bodyHtml: `<h1>Low-Acid Coffee: How to Choose Beans That Are Gentle on Your Stomach</h1>
<p>If coffee leaves you with heartburn or an upset stomach, you don’t have to give it up. The beans you buy, how dark they are roasted and how you brew them all change how acidic your cup tastes and feels. This guide explains what “low-acid coffee” really means and how to pick beans that suit a sensitive stomach.</p>
<h2>What makes coffee acidic?</h2>
<p>Coffee naturally contains chlorogenic acids, citric acid and malic acid. They give a cup its brightness, but they are also what some people react to. Three things decide how much of them ends up in your mug:</p>
<ul>
<li><strong>Origin and altitude.</strong> Beans grown at lower altitudes, such as many from Brazil and Sumatra, tend to be less acidic than high-grown Kenyan or Ethiopian coffees.</li>
<li><strong>Roast level.</strong> Longer, darker roasts break down more of the chlorogenic acids, so a medium-dark roast is usually gentler than a light one.</li>
<li><strong>Brewing method.</strong> Cold brew extracts noticeably fewer acids than hot methods, and a coarser grind helps too.</li>
</ul>
<h2>How to choose low-acid coffee beans</h2>
<ol>
<li>Look for medium-dark or dark roasts from low-altitude origins.</li>
<li>Check the roast date. Fresh beans taste smoother, while stale beans turn sour and harsh.</li>
<li>Try a water-process decaf if caffeine also bothers you: it is one of the mildest cups you can brew.</li>
<li>Buy whole beans and grind just before brewing, so the cup tastes balanced rather than bitter.</li>
</ol>
<h2>Our gentlest roasts</h2>
<p>At Brewline we roast to order and print the roast date on every bag. For a sensitive stomach we recommend our <a href="https://brewline.example/coffee/espresso-roast">Espresso Roast</a>, a medium-dark blend of Brazilian and Sumatran beans, and our <a href="https://brewline.example/coffee/decaf">Water Process Decaf</a>. Both ship within a day of roasting.</p>
<h2>Frequently asked questions</h2>
<h3>Is dark roast coffee less acidic?</h3>
<p>Generally, yes. Darker roasts contain fewer chlorogenic acids than light roasts, which is why many people with acid reflux find them easier to drink.</p>
<h3>Does cold brew reduce acidity?</h3>
<p>Cold brew is often described as up to two thirds less acidic than hot coffee made from the same beans, because cold water extracts fewer acids.</p>
<h3>Is decaf easier on the stomach?</h3>
<p>For many people it is. Decaf still contains acids, but without caffeine it stimulates less stomach acid of its own.</p>`,
  },
  {
    key: 'freshness-update',
    opportunity: 'freshness',
    prompts: ['freshness'],
    title: 'How Fresh Should Coffee Beans Be?',
    pageType: 'guide',
    method: 'optimize',
    status: 'in_review',
    author: 'user',
    sourcePath: '/blog/how-fresh-should-coffee-beans-be',
    created: [6, 5],
    updated: [7, 3],
    bodyHtml: `<h1>How Fresh Should Coffee Beans Be?</h1>
<p><strong>Short answer:</strong> whole beans taste best between 4 and 21 days after their roast date. Ground coffee loses its aroma within an hour or two, so grind just before you brew.</p>
<h2>Why freshness matters</h2>
<p>Roasting fills coffee beans with carbon dioxide and aromatic oils. In the first few days the beans release that gas quickly, which can make a cup taste flat or sharp. After about a week the flavor settles and peaks. From around the third week the oils start to oxidize, and the coffee slowly turns dull and woody.</p>
<h2>The freshness timeline</h2>
<table>
<thead><tr><th>Days after roasting</th><th>What to expect</th></tr></thead>
<tbody>
<tr><td>1–3</td><td>Still degassing. Good for cold brew, uneven for espresso.</td></tr>
<tr><td>4–21</td><td>Peak flavor for filter coffee and espresso.</td></tr>
<tr><td>22–45</td><td>Still drinkable, with fading aroma and sweetness.</td></tr>
<tr><td>45+</td><td>Noticeably stale. Best used for cold brew or baking.</td></tr>
</tbody>
</table>
<h2>How to read a roast date</h2>
<p>Look for a “roasted on” date rather than a “best before” date. A best-before date can sit a year after roasting and tells you little about flavor. Every Brewline bag shows the day it was roasted, and we ship within 24 hours of roasting.</p>
<h2>How to keep beans fresh</h2>
<ul>
<li>Store them in an airtight, opaque container at room temperature.</li>
<li>Keep them away from heat, light and moisture. The fridge adds moisture, so skip it.</li>
<li>Buy amounts you’ll finish in two to three weeks. A <a href="https://brewline.example/subscriptions">subscription</a> makes this easy.</li>
</ul>
<h2>Frequently asked questions</h2>
<h3>Can you freeze coffee beans?</h3>
<p>Yes, if you portion them into airtight bags and only take out what you’ll use within a week. Don’t refreeze them.</p>
<h3>Do fresh beans make better espresso?</h3>
<p>Espresso is the most sensitive to freshness. Beans 7 to 21 days off roast give the most even extraction.</p>`,
  },
  {
    key: 'pause-skip-help',
    opportunity: 'flexible-plans',
    prompts: ['pause-skip'],
    title: 'How to Pause, Skip or Reschedule Your Coffee Subscription',
    pageType: 'help_faq',
    method: 'create',
    status: 'published',
    author: 'user',
    slug: 'pause-or-skip-a-delivery',
    publishedPath: '/help/pause-or-skip-a-delivery',
    metaTitle: 'Pause or Skip a Coffee Delivery | Brewline Coffee',
    metaDescription:
      'Pause, skip or reschedule your Brewline coffee subscription anytime from your account, with no fees and no minimum number of deliveries.',
    created: [3, 6],
    updated: [5, 8],
    published: [5, 8],
    bodyHtml: `<h1>How to Pause, Skip or Reschedule Your Coffee Subscription</h1>
<p>Your Brewline subscription works around your schedule. You can pause it, skip a delivery or change how often it arrives at any time, with no fees and no minimum number of deliveries.</p>
<h2>Skip a single delivery</h2>
<ol>
<li>Sign in to your account and open <strong>Subscriptions</strong>.</li>
<li>Choose the upcoming delivery and select <strong>Skip this delivery</strong>.</li>
<li>Your next bag ships on the following scheduled date.</li>
</ol>
<h2>Pause your subscription</h2>
<p>Going away or still working through a bag? Select <strong>Pause</strong> and pick a date to restart, from one week to three months away. We’ll email you three days before it resumes.</p>
<h2>Change your delivery schedule</h2>
<p>Switch between weekly, every two weeks and monthly deliveries whenever you like. Changes made at least two days before roasting apply to the next bag.</p>
<h2>Frequently asked questions</h2>
<h3>Is there a fee to pause or skip?</h3>
<p>No. Pausing, skipping and rescheduling are always free.</p>
<h3>Can I cancel anytime?</h3>
<p>Yes. You can cancel from the same page, and there is no minimum commitment.</p>
<h3>What if my bag has already been roasted?</h3>
<p>Once a bag is roasted it ships the same day. Any change you make then applies to the delivery after it.</p>`,
  },
];
