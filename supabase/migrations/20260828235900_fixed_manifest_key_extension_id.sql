-- Add fixed manifest key extension ID comfcaegkabpjnffklddjjonlnfcmjkn to ia_allowed_extension_ids in Supabase Vault
select vault.update_secret(
  id,
  'kifgddajdkjjgbkijdfobpaimekbinij,kfmlggabhjjomgnbfagebppcjbpojkcd,oaelkjpljfcedcdonmmlhhbngndfphak,blladcbnobonfkeblcpdmndnpjlabfhl,adkjoiifbfdjkppiiooeneggdlpbjmkn,oeimgleilodkfdkpkhgmjbkghmiiljfn,pmadojcagnaclpacbghmaoflmjhbngnc,comfcaegkabpjnffklddjjonlnfcmjkn',
  'ia_allowed_extension_ids',
  'Approved Chrome MV3 extension IDs'
)
from vault.secrets
where name = 'ia_allowed_extension_ids';
