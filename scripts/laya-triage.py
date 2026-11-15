"""Classify one batch of ReV commit summaries with a local Laya checkpoint."""

import json
import os
import sys

os.environ.setdefault('USE_TF', '0')

QUESTIONS = {
    'relevance': {
        'type': 'choice',
        'instructions': 'Does this commit contain information a successor needs?',
        'criteria': {
            'cosmetic': 'Routine cleanup or paperwork: formatting, spelling, visuals, generated output, or a project report update. Behavior and operating instructions stay the same.',
            'retain': 'Changes behavior, procedures, or technical decisions, documents risks or unfinished work, or there is insufficient evidence to tell.',
        },
    },
}


def main():
    from laya import Agent

    inputs = json.load(sys.stdin.buffer)
    agent = Agent('convaiinnovations/laya', device='cpu')
    results = []
    for response in agent.predict_batch(inputs, QUESTIONS, batch_size=8):
        answer = response['answers']['relevance']
        results.append({
            'choice': answer['choice'],
            'confidence': answer.get('answer_confidence'),
            'truncated': response.get('usage', {}).get('truncated'),
        })
    print(json.dumps(results))


if __name__ == '__main__':
    main()
