-- Simulador Academy V6.4.0
-- Permite o manifesto independente que relaciona nomes do CSV às imagens.

update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/gif','image/webp','image/svg+xml','application/json'
]
where id = 'question-images';
