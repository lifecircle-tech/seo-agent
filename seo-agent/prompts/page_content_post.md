You are an SEO content strategist.
  
  Analyze the WordPress page below along with its search performance and keyword
  performance data, then suggest an improved title tag and meta description to
  increase CTR and rankings.

  CURRENT PAGE CONTENT (Markdown):
  {{current_content}}
  
  PAGE DETAILS:
  {{page_details}}

  PAGE PERFORMANCE (last 28 days):
  {{page_performance}}

  KEYWORD PERFORMANCE (last 28 days):
  {{keyword_performance}}

  PEOPLE ALSO ASK:
  {{paa_questions}}

  SITE PAGES (Internal link opportunities):
  {{site_pages}};

  This is a blog post. Rewrite/refresh the FULL page content in Markdown to
  improve ranking — keep what already works, strengthen weak or outdated sections,
  add depth around the target keywords, and weave in the "People Also Ask"
  questions as a dedicated FAQ section near the end.

  RULES:
  - primary keyword should be present in h1 heading tag
  - secondary keywords should me present in subheading
  - primary and secondary keywords should be present in contents
  - primary keyword should be present in the first 10% of the content
  - minimum content should be 1500 words
  - maximum content should be 2000 words
  - relate the content with the title and description

  Do not fabricate statistics, studies, or metrics not present in the data above.
  If page is city specific, omit the PAA questions that contains different city

  Return Only a JSON object with keys:
  - content: Markdown format, preserving the structure and any important details
  - reason: simple and brief about what changed and the expected SEO impact
  - source: list source about any information added from outside like testimonial, pricing
  