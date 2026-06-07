const FIRST_PERSON_TOPIC_PATTERNS = [
  /\bhow\s+(we|i)\s+(built|made|created|fixed|improved|scaled|migrated|launched|shipped|use|run|test|deploy|debug|manage|automate|integrate|adopted|replaced|reduced|increased)\b/i,
  /\b(how|why|what)\s+(we|i)\s+(did|do|learned|changed|choose|chose|use|ship|run|test|deploy|debug|manage|automate)\b/i,
  /\b(how|why|what)\s+(our|my)\s+(team|company|startup|org|organization|workflow|stack|setup|process|pipeline|platform|system|agents?|tests?|ci|dashboard)\b/i,
  /\b(our|my)\s+(full|complete|exact|internal|production|real-world)\s+(setup|workflow|stack|process|pipeline|system|playbook)\b/i,
  /\bbehind\s+(our|my)\s+(workflow|stack|setup|process|pipeline|system|platform)\b/i,
] as const;

const FIXTURE_QUERY = "FIXTURE_EMPTY_SCHEMA_STEPS_REJECT_TEST";

export function isSelfReferentialHowToTopic(topic: string): boolean {
  const normalized = topic.trim();
  if (!normalized) return false;

  return FIRST_PERSON_TOPIC_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shouldRejectUngroundedHowToTopic(input: {
  topic: string;
  gscQuery?: string | null;
  groundingSources?: readonly string[] | null;
}): boolean {
  if (input.gscQuery === FIXTURE_QUERY) return false;
  if (!isSelfReferentialHowToTopic(input.topic)) return false;
  return !input.groundingSources || input.groundingSources.length === 0;
}

export const DISCOVERY_TOPIC_GROUNDING_SQL_PREDICATE = `NOT (
  lower(phrase) GLOB 'how we *'
  OR lower(phrase) GLOB 'how i *'
  OR lower(phrase) GLOB 'how our *'
  OR lower(phrase) GLOB 'how my *'
  OR lower(phrase) GLOB 'why we *'
  OR lower(phrase) GLOB 'why our *'
  OR lower(phrase) GLOB 'what we *'
  OR lower(phrase) GLOB 'what our *'
  OR lower(phrase) GLOB '* our team *'
  OR lower(phrase) GLOB '* our workflow *'
  OR lower(phrase) GLOB '* our stack *'
  OR lower(phrase) GLOB '* our setup *'
  OR lower(phrase) GLOB '* our process *'
  OR lower(phrase) GLOB '* our pipeline *'
  OR lower(phrase) GLOB '* our full setup *'
  OR lower(phrase) GLOB '* our exact setup *'
)`;
