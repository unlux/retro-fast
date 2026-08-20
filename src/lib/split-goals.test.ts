import { describe, expect, it } from 'vitest';
import { splitGoals } from './split-goals';

describe('splitGoals', () => {
  it('returns nothing for blank input', () => {
    expect(splitGoals('')).toEqual([]);
    expect(splitGoals('   \n  \n ')).toEqual([]);
  });

  it('treats a plain sentence as one goal', () => {
    expect(splitGoals('Ship the onboarding revamp')).toEqual(['Ship the onboarding revamp']);
  });

  it('keeps hyphenated and dashed words intact in a single goal', () => {
    expect(splitGoals('Finish A-B testing for sign-up')).toEqual(['Finish A-B testing for sign-up']);
  });

  it('splits on newlines when present', () => {
    expect(splitGoals('Goal one\nGoal two\nGoal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('handles CRLF and blank lines', () => {
    expect(splitGoals('Goal one\r\n\r\nGoal two\r\n')).toEqual(['Goal one', 'Goal two']);
  });

  it('strips bullet decoration from pasted multi-line lists', () => {
    expect(splitGoals('• Goal one\n• Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('- Goal one\n- Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('1. Goal one\n2. Goal two')).toEqual(['Goal one', 'Goal two']);
  });

  it('splits single-line semicolon lists', () => {
    expect(splitGoals('Goal one; Goal two; Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('ignores a trailing semicolon', () => {
    expect(splitGoals('Goal one; Goal two;')).toEqual(['Goal one', 'Goal two']);
  });

  it('splits single-line bullet lists', () => {
    expect(splitGoals('• Goal one • Goal two')).toEqual(['Goal one', 'Goal two']);
    expect(splitGoals('Goal one • Goal two • Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('splits single-line numbered lists', () => {
    expect(splitGoals('1. Goal one 2. Goal two 3. Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
    expect(splitGoals('1) Goal one 2) Goal two')).toEqual(['Goal one', 'Goal two']);
  });

  it('prefers numbering over inner dashes and semicolons', () => {
    expect(splitGoals('1. Ship X - the new one; 2. Fix Y')).toEqual([
      'Ship X - the new one;',
      'Fix Y',
    ]);
  });

  it('splits whitespace-delimited dash bullets', () => {
    expect(splitGoals('Goal one - Goal two - Goal three')).toEqual([
      'Goal one',
      'Goal two',
      'Goal three',
    ]);
  });

  it('strips Markdown checkbox markers, keeping each item as its own row', () => {
    expect(splitGoals('- [ ] Podcast\n- [x] Blogs\n* [ ] DMs')).toEqual([
      'Podcast',
      'Blogs',
      'DMs',
    ]);
  });

  it('attaches tab-indented sub-items to their parent header', () => {
    expect(splitGoals('Decision needed\n\tTikTok\n\tEmail marketing')).toEqual([
      'Decision needed — TikTok',
      'Decision needed — Email marketing',
    ]);
  });

  it('leaves a header that has no indented children as an ordinary row', () => {
    expect(splitGoals('Decision needed\nQualified leads!')).toEqual([
      'Decision needed',
      'Qualified leads!',
    ]);
  });

  it('ends a parent group at a blank line', () => {
    expect(splitGoals('Header\n\tChild\n\nBAU\nPodcast')).toEqual([
      'Header — Child',
      'BAU',
      'Podcast',
    ]);
  });

  it('does not split a lone leading number that is not a list', () => {
    expect(splitGoals('1. Just the one goal')).toEqual(['Just the one goal']);
  });

  it('never eats digits from a decimal that only looks like a list marker', () => {
    // Regression: "1." followed immediately by a digit is a number, not a
    // marker. Retro goals are full of these and losing the "1." changes the
    // meaning of the goal.
    expect(splitGoals('1.5x conversion')).toEqual(['1.5x conversion']);
    expect(splitGoals('Lift trials\n1.5x conversion\n2.5% churn')).toEqual([
      'Lift trials',
      '1.5x conversion',
      '2.5% churn',
    ]);
    expect(splitGoals('- [ ] 1.5x conversion')).toEqual(['1.5x conversion']);
  });

  it('trims surrounding whitespace on every row', () => {
    expect(splitGoals('   Goal one   ;   Goal two   ')).toEqual(['Goal one', 'Goal two']);
  });

  it('is defensive about non-string input', () => {
    // @ts-expect-error deliberately wrong type
    expect(splitGoals(null)).toEqual([]);
    // @ts-expect-error deliberately wrong type
    expect(splitGoals(undefined)).toEqual([]);
  });
});

/**
 * Verbatim sprint goals from the three live boards, copied out of
 * docs/research/jira-discovery.md. These are the cases that actually decide
 * whether the splitter is good: if one of these regresses, real retros break.
 */
describe('splitGoals — real sprint goals', () => {
  it('Rex sprint 31 (3592): plain newline bullets', () => {
    const goal =
      "Investor FUP\nK/O money flow USA chart\nJuly Metrics\nKenny (how to demo value)\nHow to solve sales in Australia";

    expect(splitGoals(goal)).toEqual([
      'Investor FUP',
      'K/O money flow USA chart',
      'July Metrics',
      'Kenny (how to demo value)',
      'How to solve sales in Australia',
    ]);
  });

  it('Skillion Labs sprint 10 (3586): keeps apostrophes, ampersands and colons intact', () => {
    const goal =
      "FUP in the 2 RFP's we questioned - urgently\nSubmit the 2 RFP's we questioned before the deadline\nSupport Mamal leading the RFP's\nSubmit to the other Primes & FUP with BA\nSubmit a proposal for Marco\nLIN Ads\nCase #3 for Skillion Bikes\nSort and list the next RFP's Folyo\nTake a ticket to learn the ecosystem\nStripe: fill out the form";

    expect(splitGoals(goal)).toEqual([
      // Newlines win, so the inner " - urgently" is NOT treated as a delimiter.
      "FUP in the 2 RFP's we questioned - urgently",
      "Submit the 2 RFP's we questioned before the deadline",
      "Support Mamal leading the RFP's",
      'Submit to the other Primes & FUP with BA',
      'Submit a proposal for Marco',
      'LIN Ads',
      'Case #3 for Skillion Bikes',
      "Sort and list the next RFP's Folyo",
      'Take a ticket to learn the ecosystem',
      'Stripe: fill out the form',
    ]);
  });

  it('Marketing sprint 31 (3596): strips the BAU checkbox list', () => {
    const goal =
      "Google Workspace set up\nReview the Meeting with Dangaal for content improvement strategies\nFBook Ads test\nReview website copy\nRFP leads K/O\nHawkeye OEMs K/O\nTikTok start posting (download/remove)\nTest Rahul and Tirza with a long video\nPlan the YT channel using advertising\nPlan the Google Search Ads\nBAU (business as usual)\n- [ ] Podcast\n- [ ] Video Content\n- [ ] DMs\n- [ ] Blogs (handover to MY)\n- [ ] Case Study #4\n- [ ] LIN text posts";

    expect(splitGoals(goal)).toEqual([
      'Google Workspace set up',
      'Review the Meeting with Dangaal for content improvement strategies',
      'FBook Ads test',
      'Review website copy',
      'RFP leads K/O',
      'Hawkeye OEMs K/O',
      'TikTok start posting (download/remove)',
      'Test Rahul and Tirza with a long video',
      'Plan the YT channel using advertising',
      'Plan the Google Search Ads',
      // Checkboxes are flat siblings, so each becomes its own row and the
      // "BAU" line survives as an ordinary goal.
      'BAU (business as usual)',
      'Podcast',
      'Video Content',
      'DMs',
      'Blogs (handover to MY)',
      'Case Study #4',
      'LIN text posts',
    ]);
  });

  it('Marketing sprint 29 (3590): folds tab-indented sub-items, drops blank lines', () => {
    const goal =
      "Is email marketing working?\nHow to grow the channels\nHow to use Alignable\nIncrease the LIN text posts to 5/week\nLawyers in NYC\nHawkeye OEMs\nRFP leads\nFBook Ads\nLIN Ads test performance\nBe more specific about the ticket descriptions\nDecision needed\t\n\tEmail marketing\n\tTikTok\n\tHow to grow the channels\n\tAutomations page revisit\n\tRFP email ideas\nQualified leads!\n\nBAU\nPodcast, \nContent,\nDMs";

    expect(splitGoals(goal)).toEqual([
      'Is email marketing working?',
      'How to grow the channels',
      'How to use Alignable',
      'Increase the LIN text posts to 5/week',
      'Lawyers in NYC',
      'Hawkeye OEMs',
      'RFP leads',
      'FBook Ads',
      'LIN Ads test performance',
      'Be more specific about the ticket descriptions',
      // "Decision needed" is a label, not a goal: its five children absorb it.
      'Decision needed — Email marketing',
      'Decision needed — TikTok',
      'Decision needed — How to grow the channels',
      'Decision needed — Automations page revisit',
      'Decision needed — RFP email ideas',
      'Qualified leads!',
      'BAU',
      // Trailing commas are the author's punctuation; left alone.
      'Podcast,',
      'Content,',
      'DMs',
    ]);
  });

  it('Marketing sprint 30 (3594): checkbox items with trailing commas', () => {
    const goal =
      "FBook Ads\nReview website copy\nRFP leads\nEmail marketing improvements\n5 hot tips to improve the social media channels\nIncrease the LIN text posts to 5/week\nHawkeye OEMs\nDecision TikTok\nTest Rahul and Tirza with a long video\nCan we grow the YT channel using advertising\nDecide on Google Search or YT ads\nBAU\n- [ ] Podcast, \n- [ ] Video Content\n- [ ] DMs\n- [ ] Blogs\n- [ ] Case Study\n- [ ] LIN text posts";

    expect(splitGoals(goal)).toEqual([
      'FBook Ads',
      'Review website copy',
      'RFP leads',
      'Email marketing improvements',
      // A leading digit on a newline-delimited row is content, not a list marker.
      '5 hot tips to improve the social media channels',
      'Increase the LIN text posts to 5/week',
      'Hawkeye OEMs',
      'Decision TikTok',
      'Test Rahul and Tirza with a long video',
      'Can we grow the YT channel using advertising',
      'Decide on Google Search or YT ads',
      'BAU',
      'Podcast,',
      'Video Content',
      'DMs',
      'Blogs',
      'Case Study',
      'LIN text posts',
    ]);
  });

  it('Skillion Labs sprint 4 (3536): tolerates the pseudo-XML block and WIP/NOT annotations', () => {
    const goal =
      "Metricool WIP\n\n<ambition>\nReview Googles AI advertising offer NOT\nAI level up sales material (1 pager, scripts) NOT\nSales focus WIP";

    // Nothing clever: the tag line becomes its own row (one manual delete) and
    // every annotation is preserved verbatim.
    expect(splitGoals(goal)).toEqual([
      'Metricool WIP',
      '<ambition>',
      'Review Googles AI advertising offer NOT',
      'AI level up sales material (1 pager, scripts) NOT',
      'Sales focus WIP',
    ]);
  });
});
