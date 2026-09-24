# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately through GitHub's private vulnerability
reporting: open the repository's **Security** tab and choose **Report a vulnerability**
(GitHub Security Advisories). Do not open a public issue, discussion or pull request for a
suspected vulnerability.

Include, where possible:

- the affected component (API server, console, engine, an SDK, `otsone`) and version or commit;
- steps to reproduce or a proof of concept;
- the impact you believe it has.

We aim to acknowledge reports within 5 business days and to agree on a disclosure
timeline with you. Please give us a reasonable chance to release a fix before disclosing
publicly. We are happy to credit reporters in the advisory unless you prefer otherwise.

## Supported versions

OpenJev is pre-1.0. Security fixes are made on the `main` branch; please test against the
latest commit before reporting.

## Scope

OpenJev is self-hosted software; there is no official hosted service. Reports about third
party deployments should go to their operators. Issues in upstream dependencies should be
reported upstream, but let us know if OpenJev's use of them is exploitable.
