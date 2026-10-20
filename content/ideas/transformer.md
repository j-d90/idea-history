---
title: The Transformer
category: technology
status: sourced
date:
  year: 2017
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
sources:
  - key: vaswani-2017
    type: primary
    author: Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit, Llion Jones, Aidan N. Gomez,
      Łukasz Kaiser, Illia Polosukhin
    title: Attention Is All You Need
    publisher: Advances in Neural Information Processing Systems 30 (NeurIPS 2017)
    year: 2017
    url: https://arxiv.org/abs/1706.03762
    accessed: 2026-10-20
  - key: bahdanau-2014
    type: primary
    author: Dzmitry Bahdanau, Kyunghyun Cho, Yoshua Bengio
    title: Neural Machine Translation by Jointly Learning to Align and Translate
    year: 2014
    url: https://arxiv.org/abs/1409.0473
    accessed: 2026-10-20
  - key: devlin-2018
    type: primary
    author: Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
    year: 2018
    url: https://arxiv.org/abs/1810.04805
    accessed: 2026-10-20
  - key: brown-2020
    type: primary
    author: Tom B. Brown et al.
    title: Language Models are Few-Shot Learners
    year: 2020
    locator: §2.1
    url: https://arxiv.org/abs/2005.14165
    accessed: 2026-10-20
---

**The idea.** Vaswani et al. (2017) proposed "a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely." Attention itself was older. Bahdanau, Cho and Bengio (2014) had added it to recurrent translation models, letting a model "(soft-)search for parts of a source sentence that are relevant to predicting a target word." The Transformer's step was to make attention the whole architecture.

**What followed.** BERT, short for "Bidirectional Encoder Representations from Transformers" (Devlin et al. 2018), and GPT-3, which uses "the same model and architecture as GPT-2" with sparse attention patterns "in the layers of the transformer" (Brown et al. 2020, §2.1), were both built on it.
