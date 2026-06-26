// grouping.test.js
//
// Unit tests for the pure grouping engine (identify.js + grouping.js).
// Zero dependencies — uses Node's built-in test runner.
//
//   node --test
//
// Every test uses generic, non-company-specific hosts/names.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractId, fixedGroup, normalizeName } from './identify.js';
import { classifyTab, computeBuckets, buildUmbrellas } from './grouping.js';

// A small generic config used across tests.
const CONFIG = {
  excludedHosts: ['google.com'],
  extractRules: [
    { host: 'github.com', pattern: 'github\\.com/[^/]+/([^/?#]+)' },
    { host: 'ci.example.com', pattern: '/pipelines/([^/?#]+)' },
    { host: 'tickets.example.com', pattern: '/(T\\d+)' }
  ],
  stripSuffixes: ['Service', 'CDK', 'Tests'],
  fixedHostGroups: [
    { host: 'jira.example.com', name: 'JIRA' },
    { host: 'wiki.example.com/Runbook', name: 'Runbooks' }
  ],
  projects: []
};

const tab = (url, extra = {}) => ({ url, ...extra });

// --- identify.js: extractId -------------------------------------------------

test('extractId: github repo from path', () => {
  assert.deepEqual(
    extractId('https://github.com/acme/payments-api/issues/1', CONFIG),
    { id: 'payments-api', raw: 'payments-api' }
  );
});

test('extractId: matches an id in the hostname (subdomain)', () => {
  const cfg = { ...CONFIG, extractRules: [{ host: 'console.example.com', pattern: '(\\d{12})' }] };
  assert.equal(extractId('https://937963325720-abc.eu.console.example.com/home', cfg).id, '937963325720');
});

test('extractId: matches an id in a query parameter', () => {
  const cfg = { ...CONFIG, extractRules: [{ host: 'metrics.example.com', pattern: 'service=([^&]+)' }] };
  assert.equal(extractId('https://metrics.example.com/g?service=Checkout&x=1', cfg).id, 'Checkout');
});

test('extractId: excluded host returns null', () => {
  assert.equal(extractId('https://google.com/search?q=hi', CONFIG), null);
});

test('extractId: non-http scheme returns null', () => {
  assert.equal(extractId('chrome://extensions', CONFIG), null);
});

test('extractId: no matching rule returns null', () => {
  assert.equal(extractId('https://news.ycombinator.com/item?id=1', CONFIG), null);
});

// --- identify.js: normalizeName (suffix stripping) --------------------------

test('normalizeName: strips a known suffix', () => {
  assert.equal(normalizeName('PaymentsCDK', ['CDK']), 'Payments');
});

test('normalizeName: strips repeatedly until stable', () => {
  assert.equal(normalizeName('PaymentsServiceTests', ['Service', 'Tests']), 'Payments');
});

test('normalizeName: leaves unknown suffixes intact', () => {
  assert.equal(normalizeName('PaymentsWidget', ['CDK']), 'PaymentsWidget');
});

test('normalizeName: never strips down to empty', () => {
  assert.equal(normalizeName('CDK', ['CDK']), 'CDK');
});

// --- identify.js: fixedGroup ------------------------------------------------

test('fixedGroup: matches a plain host', () => {
  assert.equal(fixedGroup('https://jira.example.com/browse/AB-1', CONFIG), 'JIRA');
});

test('fixedGroup: matches a host + path prefix rule', () => {
  assert.equal(fixedGroup('https://wiki.example.com/Runbook/foo', CONFIG), 'Runbooks');
});

test('fixedGroup: no match returns null', () => {
  assert.equal(fixedGroup('https://example.org/x', CONFIG), null);
});

// --- grouping.js: classifyTab -----------------------------------------------

test('classifyTab: keyword wins over everything', () => {
  const umb = buildUmbrellas(['Falcon'], CONFIG);
  const c = classifyTab(tab('https://github.com/acme/Falcon-api', { title: 'Falcon' }), umb, CONFIG);
  assert.equal(c.kind, 'keyword');
  assert.equal(c.key, 'Falcon');
});

test('classifyTab: abstraction when a rule matches', () => {
  const c = classifyTab(tab('https://github.com/acme/widget'), [], CONFIG);
  assert.equal(c.kind, 'abstraction');
  assert.equal(c.key, 'widget');
});

test('classifyTab: site when only a fixed host matches', () => {
  const c = classifyTab(tab('https://jira.example.com/browse/AB-1'), [], CONFIG);
  assert.equal(c.kind, 'site');
  assert.equal(c.key, 'JIRA');
});

test('classifyTab: unmatched tab returns null', () => {
  assert.equal(classifyTab(tab('https://example.org/x'), [], CONFIG), null);
});

// --- grouping.js: computeBuckets --------------------------------------------

const names = (buckets) => [...buckets.keys()].sort();

test('computeBuckets: clubs tabs sharing an extracted name', () => {
  const tabs = [
    tab('https://github.com/acme/widget/issues'),
    tab('https://github.com/acme/widget/pulls')
  ];
  const b = computeBuckets(tabs, [], CONFIG, 2);
  assert.deepEqual(names(b), ['widget']);
  assert.equal(b.get('widget').length, 2);
});

test('computeBuckets: package + pipeline club under same stripped name', () => {
  const tabs = [
    tab('https://github.com/acme/CheckoutService/tree/main'),
    tab('https://ci.example.com/pipelines/CheckoutService')
  ];
  const b = computeBuckets(tabs, [], CONFIG, 2);
  // both normalize to "Checkout" (Service stripped)
  assert.deepEqual(names(b), ['Checkout']);
  assert.equal(b.get('Checkout').length, 2);
});

test('computeBuckets: a lone abstraction tab is dropped (below minGroupSize)', () => {
  const tabs = [tab('https://github.com/acme/onlyone')];
  const b = computeBuckets(tabs, [], CONFIG, 2);
  assert.deepEqual(names(b), []);
});

test('computeBuckets: lone abstraction orphans fall into their site group', () => {
  // Each wiki runbook names a different service (Alpha, Beta) -> each is a
  // singleton -> both re-route to the "Runbooks" site group (matched on the
  // "/Runbook" substring, which appears in each path).
  const cfg = {
    ...CONFIG,
    extractRules: [{ host: 'wiki.example.com', pattern: '/([A-Z][a-zA-Z]+)/Runbook' }],
    fixedHostGroups: [{ host: 'wiki.example.com', name: 'Runbooks' }]
  };
  const tabs = [
    tab('https://wiki.example.com/x/Alpha/Runbook'),
    tab('https://wiki.example.com/y/Beta/Runbook')
  ];
  const b = computeBuckets(tabs, [], cfg, 2);
  assert.deepEqual(names(b), ['Runbooks']);
  assert.equal(b.get('Runbooks').length, 2);
});

test('computeBuckets: orphan with a matching service does NOT fall to site', () => {
  // If a wiki runbook's service has other tabs, it clubs by service, not site.
  const cfg = {
    ...CONFIG,
    extractRules: [
      { host: 'github.com', pattern: 'github\\.com/[^/]+/([^/?#]+)' },
      { host: 'wiki.example.com', pattern: '/([A-Z][a-zA-Z]+)/Runbook' }
    ],
    fixedHostGroups: [{ host: 'wiki.example.com', name: 'Runbooks' }]
  };
  const tabs = [
    tab('https://github.com/acme/Alpha/tree/main'),
    tab('https://wiki.example.com/x/Alpha/Runbook')
  ];
  const b = computeBuckets(tabs, [], cfg, 2);
  assert.deepEqual(names(b), ['Alpha']); // clubbed by service, not "Runbooks"
  assert.equal(b.get('Alpha').length, 2);
});

test('computeBuckets: skipGrouped ignores tabs already in a group', () => {
  const tabs = [
    tab('https://github.com/acme/widget/a', { groupId: 5 }),
    tab('https://github.com/acme/widget/b', { groupId: 5 }),
    tab('https://github.com/acme/widget/c', { groupId: -1 }) // loose, lone
  ];
  // With skipGrouped, only the lone loose tab is considered -> dropped (size 1).
  const b = computeBuckets(tabs, [], CONFIG, 2, true);
  assert.deepEqual(names(b), []);
});

test('computeBuckets: a lone loose tab JOINS an existing group of the same name', () => {
  const tabs = [
    tab('https://github.com/acme/widget/a', { groupId: 5 }), // grouped, skipped
    tab('https://github.com/acme/widget/b', { groupId: -1 }) // loose, lone
  ];
  const existing = new Set(['widget']);
  const b = computeBuckets(tabs, [], CONFIG, 2, true, existing);
  assert.deepEqual(names(b), ['widget']);
  assert.equal(b.get('widget').length, 1); // the one loose tab, to merge in
});

test('computeBuckets: pinned tabs are never grouped', () => {
  const tabs = [
    tab('https://github.com/acme/widget/a', { pinned: true }),
    tab('https://github.com/acme/widget/b', { pinned: true })
  ];
  assert.deepEqual(names(computeBuckets(tabs, [], CONFIG, 2)), []);
});

test('computeBuckets: distinct services do NOT merge (no over-grouping)', () => {
  const tabs = [
    tab('https://github.com/acme/RoutePickingService/a'),
    tab('https://github.com/acme/RoutePickingService/b'),
    tab('https://github.com/acme/RouteStagingService/a'),
    tab('https://github.com/acme/RouteStagingService/b')
  ];
  const b = computeBuckets(tabs, [], CONFIG, 2);
  // "Service" is stripped but the rest differs -> two separate groups.
  assert.deepEqual(names(b), ['RoutePicking', 'RouteStaging']);
});

test('computeBuckets: keyword clubs differently-named tabs together', () => {
  const umb = buildUmbrellas(['Falcon'], CONFIG);
  const tabs = [
    tab('https://github.com/acme/falcon-api', { title: 'falcon api' }),
    tab('https://docs.example.com/falcon-plan', { title: 'Falcon plan' })
  ];
  const b = computeBuckets(tabs, umb, CONFIG, 2);
  assert.deepEqual(names(b), ['Falcon']);
  assert.equal(b.get('Falcon').length, 2);
});
