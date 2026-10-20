---
title: The Transformer
category: technology
status: sourced
date:
  year: 2017
  marks: Publication of "Attention Is All You Need"
origin: Vaswani et al., "Attention Is All You Need"
summary: >-
  A neural network architecture built on attention alone, without recurrence, so it can be trained
  efficiently in parallel. It became the basis of language models such as BERT (2018) and GPT-3
  (2020).
buildsOn:
  - id: deep-learning
    why: >-
      The Transformer is a deep neural network that replaced the recurrent and convolutional
      networks then dominant in sequence modelling.
    sources: [vaswani-2017]
sources: [vaswani-2017, bahdanau-2014, devlin-2018, brown-2020]
---

**The idea.** The paper proposed "a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely." The authors reported that it was "more parallelizable" and required "significantly less time to train" than the recurrent and convolutional models it replaced [@vaswani-2017, abstract].

**What was new.** Attention itself was older. It had already been added to recurrent translation models, letting a model "(soft-)search for parts of a source sentence that are relevant to predicting a target word" [@bahdanau-2014, abstract]. The Transformer's step was to make attention the whole architecture.

**What followed.** BERT, short for "Bidirectional Encoder Representations from Transformers" [@devlin-2018, abstract], was built on it. So was GPT-3, which uses "the same model and architecture as GPT-2" with sparse attention patterns "in the layers of the transformer" [@brown-2020, §2.1].
