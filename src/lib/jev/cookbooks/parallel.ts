import type { Questions } from "../types";

export const GDPR_STATE = `General Data Protection Regulation (GDPR) is a regulation in EU law on data protection and privacy for individuals within the European Union and the European Economic Area. It also addresses the transfer of personal data outside the EU and EEA areas. The GDPR's primary aim is to give individuals control over their personal data and to simplify the regulatory environment for international business by unifying the regulation within the EU.

Personal data means any information relating to an identified or identifiable natural person ('data subject'); an identifiable natural person is one who can be identified, directly or indirectly, in particular by reference to an identifier such as a name, an identification number, location data, an online identifier or to one or more factors specific to the physical, physiological, genetic, mental, economic, cultural or social identity of that natural person.

Lawful bases for processing (Article 6): processing is lawful only if and to the extent that at least one of the following applies: (a) the data subject has given consent to the processing of his or her personal data for one or more specific purposes; (b) processing is necessary for the performance of a contract; (c) processing is necessary for compliance with a legal obligation; (d) processing is necessary in order to protect the vital interests of the data subject; (e) processing is necessary for the performance of a task carried out in the public interest; (f) processing is necessary for the purposes of the legitimate interests pursued by the controller or by a third party, except where such interests are overridden by the interests or fundamental rights and freedoms of the data subject.

Consent must be freely given, specific, informed and unambiguous. Silence, pre-ticked boxes or inactivity do not constitute consent. The controller must be able to demonstrate that the data subject has consented. Consent can be withdrawn at any time.

Special categories of personal data (Article 9) — racial or ethnic origin, political opinions, religious or philosophical beliefs, trade union membership, genetic data, biometric data, health, sex life or sexual orientation — are prohibited unless a specific exception applies, including explicit consent.

Data subjects have the right of access, rectification, erasure ('right to be forgotten'), restriction of processing, data portability, and the right to object to processing including profiling. Controllers must notify a personal data breach to the supervisory authority without undue delay and, where feasible, not later than 72 hours after becoming aware of it, unless the breach is unlikely to result in a risk to rights and freedoms.

A Data Protection Officer must be designated where processing is carried out by a public authority, or where the core activities consist of regular and systematic monitoring of data subjects on a large scale, or large-scale processing of special categories. Transfers to third countries require an adequacy decision, appropriate safeguards such as standard contractual clauses, or a derogation.

A Data Protection Impact Assessment is required where processing is likely to result in a high risk to the rights and freedoms of natural persons, in particular using new technologies. Children's personal data merits specific protection; information society services offered directly to a child, consent is valid if the child is at least 16 (member states may lower to 13). The GDPR applies to controllers and processors in the Union, and to those outside the Union offering goods or services to data subjects in the Union or monitoring their behaviour.`;

export const PARALLEL_QUESTIONS: Questions = {
  defines_personal_data: {
    type: "noul",
    instructions: "Does this text define personal data as information relating to an identified or identifiable natural person?",
    criteria: {
      true: "It states the identifiable-person definition, including identifiers",
      false: "No definition of personal data, or a conflicting one",
    },
  },
  consent_is_a_lawful_basis: {
    type: "noul",
    instructions: "Is consent listed as a lawful basis for processing?",
    criteria: {
      true: "Article 6(a) style consent is named as a basis",
      false: "Consent is omitted from lawful bases",
    },
  },
  legitimate_interest_exists: {
    type: "noul",
    instructions: "Does the text recognise legitimate interests as a lawful basis, with a balancing test against the data subject's rights?",
    criteria: {
      true: "Legitimate interests plus an override/balancing clause",
      false: "No legitimate-interest basis",
    },
  },
  pre_ticked_invalid: {
    type: "noul",
    instructions: "Does the text say that silence, pre-ticked boxes, or inactivity do not count as consent?",
    criteria: {
      true: "Explicitly rejects pre-ticked or silent consent",
      false: "Allows implied or pre-ticked consent",
    },
  },
  special_categories_prohibited: {
    type: "noul",
    instructions: "Are special categories of data (health, biometrics, race, politics, etc.) generally prohibited unless an exception applies?",
    criteria: {
      true: "Prohibition plus exceptions such as explicit consent",
      false: "Special categories are treated like ordinary data",
    },
  },
  right_to_erasure: {
    type: "noul",
    instructions: "Does a data subject have a right to erasure / to be forgotten?",
    criteria: {
      true: "Erasure or right to be forgotten is listed",
      false: "No erasure right",
    },
  },
  breach_72h: {
    type: "noul",
    instructions: "Must a personal data breach be notified to the supervisory authority within 72 hours where feasible?",
    criteria: {
      true: "72-hour notification duty is stated",
      false: "No 72-hour clock, or notification is optional",
    },
  },
  dpo_required_when: {
    type: "choice",
    instructions: "When must a Data Protection Officer be designated?",
    criteria: {
      public_or_large_scale:
        "Public authority, large-scale systematic monitoring, or large-scale special-category processing",
      always: "Every controller, regardless of size",
      never: "DPO is never required",
      only_us: "Only for US companies",
    },
  },
  third_country_transfers: {
    type: "choice",
    instructions: "How may personal data be transferred to a third country?",
    criteria: {
      adequacy_or_safeguards:
        "Adequacy decision, appropriate safeguards such as SCCs, or a listed derogation",
      free_flow: "Free flow with no extra conditions",
      banned: "All extra-EU transfers are banned",
      encryption_only: "Encryption alone is sufficient",
    },
  },
  dpia_when: {
    type: "noul",
    instructions: "Is a Data Protection Impact Assessment required when processing is likely to result in high risk, especially with new technologies?",
    criteria: {
      true: "DPIA is required for high-risk / new-technology processing",
      false: "DPIA is never mentioned or is optional always",
    },
  },
  child_consent_age: {
    type: "choice",
    instructions: "What is the default age at which a child can consent to information-society services under GDPR, subject to member-state lowering?",
    criteria: {
      "16": "Default 16, member states may lower to 13",
      "13": "Hard floor of 13 with no default 16",
      "18": "Always 18",
      "none": "Children cannot consent",
    },
  },
  territorial_scope: {
    type: "noul",
    instructions: "Does GDPR apply to controllers outside the Union that offer goods or services to, or monitor the behaviour of, people in the Union?",
    criteria: {
      true: "Extra-territorial offering/monitoring test is stated",
      false: "Only EU-established controllers are in scope",
    },
  },
  profiling_objection: {
    type: "noul",
    instructions: "Do data subjects have a right to object to processing, including profiling?",
    criteria: {
      true: "Right to object, including profiling, is listed",
      false: "No objection right",
    },
  },
};

export const PARALLEL_META = {
  id: "parallel",
  title: "Parallel questions",
  blurb:
    "A 13-question regulatory briefing over a GDPR excerpt. Batching every question into one System One call is the whole trick: extra questions are cheap; extra round-trips are not.",
  stat: "13 questions, 1 call",
  href: "/cookbooks/parallel",
};
