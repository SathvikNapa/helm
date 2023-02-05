from statistics import mean
from typing import List, Optional

from helm.common.request import RequestResult
from helm.benchmark.adaptation.request_state import RequestState
from helm.benchmark.adaptation.adapter_spec import AdapterSpec
from helm.benchmark.metrics.statistic import Stat
from helm.benchmark.metrics.metric import Metric
from helm.benchmark.metrics.metric_name import MetricName
from helm.benchmark.metrics.metric_service import MetricService
from .aesthetics_scorer import AestheticsScorer


class AestheticsMetric(Metric):
    def __init__(self):
        self._aesthetics_scorer: Optional[AestheticsScorer] = None

    def __repr__(self):
        return "AestheticsMetric()"

    def evaluate_generation(
        self,
        adapter_spec: AdapterSpec,
        request_state: RequestState,
        metric_service: MetricService,
        eval_cache_path: str,
    ) -> List[Stat]:
        assert request_state.result is not None
        request_result: RequestResult = request_state.result

        if self._aesthetics_scorer is None:
            self._aesthetics_scorer = AestheticsScorer()

        # Compute the aesthetics score for each generated image
        scores: List[float] = []
        for image in request_result.completions:
            # Models like DALL-E 2 can skip generating images for prompts that violate their content policy
            if image.file_location is None:
                return []

            scores.append(self._aesthetics_scorer.compute_aesthetics_score(image.file_location))

        stats: List[Stat] = [
            Stat(MetricName("expected_aesthetics_score")).add(mean(scores) if len(scores) > 0 else 0),
            Stat(MetricName("max_aesthetics_score")).add(max(scores) if len(scores) > 0 else 0),
        ]
        return stats