
==============================================================================
-- first_party_sets.db
-- meta: {"mmap_status": "-1", "version": "5", "last_compatible_version": "5", "run_count": "1"}
-- rows: {"browser_context_sets_version": 0, "browser_context_sites_to_clear": 0, "browser_contexts_cleared": 2, "manual_configurations": 0, "meta": 4, "policy_configurations": 0, "public_sets": 0}
==============================================================================
CREATE TABLE browser_context_sets_version(browser_context_id TEXT PRIMARY KEY NOT NULL,public_sets_version TEXT NOT NULL)WITHOUT ROWID;
CREATE TABLE browser_context_sites_to_clear(browser_context_id TEXT NOT NULL,site TEXT NOT NULL,marked_at_run INTEGER NOT NULL,PRIMARY KEY(browser_context_id,site))WITHOUT ROWID;
CREATE TABLE browser_contexts_cleared(browser_context_id TEXT PRIMARY KEY NOT NULL,cleared_at_run INTEGER NOT NULL)WITHOUT ROWID;
CREATE TABLE manual_configurations(browser_context_id TEXT NOT NULL,site TEXT NOT NULL,primary_site TEXT,site_type INTEGER,PRIMARY KEY(browser_context_id,site))WITHOUT ROWID;
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE policy_configurations(browser_context_id TEXT NOT NULL,site TEXT NOT NULL,primary_site TEXT,PRIMARY KEY(browser_context_id,site))WITHOUT ROWID;
CREATE TABLE public_sets(version TEXT NOT NULL,site TEXT NOT NULL,primary_site TEXT NOT NULL,site_type INTEGER NOT NULL,PRIMARY KEY(version,site))WITHOUT ROWID;
CREATE INDEX idx_cleared_at_run_browser_contexts ON browser_contexts_cleared(cleared_at_run);
CREATE INDEX idx_marked_at_run_sites ON browser_context_sites_to_clear(marked_at_run);
CREATE INDEX idx_public_sets_version_browser_contexts ON browser_context_sets_version(public_sets_version);

==============================================================================
-- Profile 1/Account Web Data
-- meta: {"mmap_status": "-1", "version": "152", "last_compatible_version": "151"}
-- rows: {"autofill_model_type_state": 0, "autofill_sync_metadata": 0, "benefit_merchant_domains": 0, "credit_cards": 0, "generic_payment_instruments": 0, "local_ibans": 0, "local_stored_cvc": 0, "masked_bank_accounts": 0, "masked_bank_accounts_metadata": 0, "masked_credit_card_benefits": 0, "masked_credit_cards": 0, "masked_ibans": 0, "masked_ibans_metadata": 0, "meta": 3, "offer_data": 0, "offer_eligible_instrument": 0, "offer_merchant_domain": 0, "payment_instrument_creation_options": 0, "payments_customer_data": 0, "server_card_cloud_token_data": 0, "server_card_metadata": 0, "server_stored_cvc": 0, "virtual_card_usage_data": 0}
==============================================================================
CREATE TABLE autofill_model_type_state (model_type INTEGER NOT NULL PRIMARY KEY, value BLOB);
CREATE TABLE autofill_sync_metadata (model_type INTEGER NOT NULL, storage_key VARCHAR NOT NULL, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE benefit_merchant_domains (benefit_id VARCHAR NOT NULL, merchant_domain VARCHAR NOT NULL);
CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER NOT NULL DEFAULT 0, origin VARCHAR DEFAULT '', use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR, nickname VARCHAR);
CREATE TABLE generic_payment_instruments (instrument_id INTEGER PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE local_ibans (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, value_encrypted VARCHAR, nickname VARCHAR);
CREATE TABLE local_stored_cvc (guid VARCHAR PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE masked_bank_accounts (instrument_id INTEGER PRIMARY KEY NOT NULL, bank_name VARCHAR, account_number_suffix VARCHAR, account_type INTEGER DEFAULT 0, display_icon_url VARCHAR, nickname VARCHAR);
CREATE TABLE masked_bank_accounts_metadata (instrument_id INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE masked_credit_card_benefits (benefit_id VARCHAR PRIMARY KEY NOT NULL, instrument_id INTEGER NOT NULL DEFAULT 0, benefit_type INTEGER NOT NULL DEFAULT 0, benefit_category INTEGER NOT NULL DEFAULT 0, benefit_description VARCHAR NOT NULL, start_time INTEGER, end_time INTEGER);
CREATE TABLE masked_credit_cards (id VARCHAR, name_on_card VARCHAR, network VARCHAR, last_four VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, bank_name VARCHAR, nickname VARCHAR, card_issuer INTEGER DEFAULT 0, instrument_id INTEGER DEFAULT 0, virtual_card_enrollment_state INTEGER DEFAULT 0, card_art_url VARCHAR, product_description VARCHAR, card_issuer_id VARCHAR, virtual_card_enrollment_type INTEGER DEFAULT 0, product_terms_url VARCHAR, card_info_retrieval_enrollment_state INTEGER DEFAULT 0, card_benefit_source INTEGER DEFAULT 0, card_creation_source INTEGER DEFAULT 0);
CREATE TABLE masked_ibans (instrument_id VARCHAR PRIMARY KEY NOT NULL, prefix VARCHAR NOT NULL, suffix VARCHAR NOT NULL, nickname VARCHAR);
CREATE TABLE masked_ibans_metadata (instrument_id VARCHAR PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE offer_data (offer_id UNSIGNED LONG, offer_reward_amount VARCHAR, expiry UNSIGNED LONG, offer_details_url VARCHAR, merchant_domain VARCHAR, promo_code VARCHAR, value_prop_text VARCHAR, see_details_text VARCHAR, usage_instructions_text VARCHAR);
CREATE TABLE offer_eligible_instrument (offer_id UNSIGNED LONG, instrument_id UNSIGNED LONG);
CREATE TABLE offer_merchant_domain (offer_id UNSIGNED LONG, merchant_domain VARCHAR);
CREATE TABLE payment_instrument_creation_options (id VARCHAR PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE payments_customer_data (customer_id VARCHAR);
CREATE TABLE server_card_cloud_token_data (id VARCHAR, suffix VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, card_art_url VARCHAR, instrument_token VARCHAR);
CREATE TABLE server_card_metadata (id VARCHAR NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR);
CREATE TABLE server_stored_cvc (instrument_id INTEGER PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE virtual_card_usage_data (id VARCHAR PRIMARY KEY, instrument_id INTEGER DEFAULT 0, merchant_domain VARCHAR, last_four VARCHAR);

==============================================================================
-- Profile 1/Affiliation Database
-- meta: {"mmap_status": "-1", "version": "7", "last_compatible_version": "1"}
-- rows: {"eq_class_groups": 0, "eq_class_members": 0, "eq_classes": 0, "meta": 3, "psl_extensions": 0, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE eq_class_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, facet_uri LONGVARCHAR NOT NULL, set_id INTEGER NOT NULL REFERENCES eq_classes(id) ON DELETE CASCADE, main_domain VARCHAR, change_password_url VARCHAR);
CREATE TABLE eq_class_members (id INTEGER PRIMARY KEY AUTOINCREMENT, facet_uri LONGVARCHAR NOT NULL, set_id INTEGER NOT NULL REFERENCES eq_classes(id) ON DELETE CASCADE, facet_display_name VARCHAR, facet_icon_url VARCHAR, change_password_url VARCHAR, UNIQUE (facet_uri));
CREATE TABLE eq_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, last_update_time INTEGER, group_display_name VARCHAR, group_icon_url VARCHAR);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE psl_extensions (domain VARCHAR NOT NULL, UNIQUE (domain));
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX index_on_eq_class_members_set_id ON eq_class_members (set_id);
CREATE INDEX index_on_eq_groups_set_id_index ON eq_class_groups (set_id);
CREATE INDEX index_on_eq_groups_url_index ON eq_class_groups (facet_uri);

==============================================================================
-- Profile 1/BrowsingTopicsSiteData
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"browsing_topics_api_hashed_to_unhashed_domain": 0, "browsing_topics_api_usages": 0, "meta": 3}
==============================================================================
CREATE TABLE browsing_topics_api_hashed_to_unhashed_domain(hashed_context_domain INTEGER PRIMARY KEY,context_domain TEXT NOT NULL);
CREATE TABLE browsing_topics_api_usages(hashed_context_domain INTEGER NOT NULL,hashed_main_frame_host INTEGER NOT NULL,last_usage_time INTEGER NOT NULL,PRIMARY KEY (hashed_context_domain,hashed_main_frame_host));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE INDEX last_usage_time_idx ON browsing_topics_api_usages(last_usage_time);

==============================================================================
-- Profile 1/Cookies
-- meta: {"mmap_status": "-1", "version": "24", "last_compatible_version": "24"}
-- rows: {"cookies": 1, "meta": 3}
==============================================================================
CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port);

==============================================================================
-- Profile 1/DIPS
-- meta: {"mmap_status": "-1", "version": "11", "last_compatible_version": "11"}
-- rows: {"bounces": 0, "config": 1, "meta": 3, "popups": 0}
==============================================================================
CREATE TABLE bounces(site TEXT PRIMARY KEY NOT NULL,first_user_activation_time INTEGER,last_user_activation_time INTEGER,first_bounce_time INTEGER,last_bounce_time INTEGER,first_web_authn_assertion_time INTEGER,last_web_authn_assertion_time INTEGER);
CREATE TABLE config(key TEXT NOT NULL,int_value INTEGER,PRIMARY KEY (`key`));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE popups(opener_site TEXT NOT NULL,popup_site TEXT NOT NULL,access_id INT64,last_popup_time INTEGER,is_current_interaction BOOLEAN,is_authentication_interaction BOOLEAN,PRIMARY KEY (`opener_site`,`popup_site`));

==============================================================================
-- Profile 1/Favicons
-- meta: {"mmap_status": "-1", "version": "9", "last_compatible_version": "9"}
-- rows: {"favicon_bitmaps": 2, "favicons": 1, "icon_mapping": 1, "meta": 3}
==============================================================================
CREATE TABLE favicon_bitmaps(id INTEGER PRIMARY KEY,icon_id INTEGER NOT NULL,last_updated INTEGER DEFAULT 0,image_data BLOB,width INTEGER DEFAULT 0,height INTEGER DEFAULT 0,last_requested INTEGER DEFAULT 0);
CREATE TABLE favicons(id INTEGER PRIMARY KEY,url LONGVARCHAR NOT NULL,icon_type INTEGER DEFAULT 1);
CREATE TABLE icon_mapping(id INTEGER PRIMARY KEY,page_url LONGVARCHAR NOT NULL,icon_id INTEGER,page_url_type INTEGER DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE INDEX favicon_bitmaps_icon_id ON favicon_bitmaps(icon_id);
CREATE INDEX favicons_url ON favicons(url);
CREATE INDEX icon_mapping_icon_id_idx ON icon_mapping(icon_id);
CREATE INDEX icon_mapping_page_url_idx ON icon_mapping(page_url);

==============================================================================
-- Profile 1/History
-- meta: {"mmap_status": "-1", "version": "70", "last_compatible_version": "16", "early_expiration_threshold": "13422663094942376"}
-- rows: {"cluster_keywords": 0, "cluster_visit_duplicates": 0, "clusters": 0, "clusters_and_visits": 0, "content_annotations": 2, "context_annotations": 2, "downloads": 0, "downloads_slices": 0, "downloads_url_chains": 0, "history_sync_metadata": 0, "keyword_search_terms": 0, "meta": 4, "segment_usage": 0, "segments": 0, "sqlite_sequence": 2, "urls": 3, "visit_source": 0, "visited_links": 0, "visits": 3}
==============================================================================
CREATE TABLE cluster_keywords(cluster_id INTEGER NOT NULL,keyword VARCHAR NOT NULL,type INTEGER NOT NULL,score NUMERIC NOT NULL,collections VARCHAR NOT NULL);
CREATE TABLE cluster_visit_duplicates(visit_id INTEGER NOT NULL,duplicate_visit_id INTEGER NOT NULL,PRIMARY KEY(visit_id,duplicate_visit_id))WITHOUT ROWID;
CREATE TABLE clusters(cluster_id INTEGER PRIMARY KEY AUTOINCREMENT,should_show_on_prominent_ui_surfaces BOOLEAN NOT NULL,label VARCHAR NOT NULL,raw_label VARCHAR NOT NULL,triggerability_calculated BOOLEAN NOT NULL,originator_cache_guid TEXT NOT NULL,originator_cluster_id INTEGER NOT NULL);
CREATE TABLE clusters_and_visits(cluster_id INTEGER NOT NULL,visit_id INTEGER NOT NULL,score NUMERIC DEFAULT 0 NOT NULL,engagement_score NUMERIC DEFAULT 0 NOT NULL,url_for_deduping LONGVARCHAR NOT NULL,normalized_url LONGVARCHAR NOT NULL,url_for_display LONGVARCHAR NOT NULL,interaction_state INTEGER DEFAULT 0 NOT NULL,PRIMARY KEY(cluster_id,visit_id))WITHOUT ROWID;
CREATE TABLE content_annotations(visit_id INTEGER PRIMARY KEY,visibility_score NUMERIC,floc_protected_score NUMERIC,categories VARCHAR,page_topics_model_version INTEGER,annotation_flags INTEGER NOT NULL,entities VARCHAR,related_searches VARCHAR,search_normalized_url VARCHAR,search_terms LONGVARCHAR,alternative_title VARCHAR,page_language VARCHAR,password_state INTEGER DEFAULT 0 NOT NULL,has_url_keyed_image BOOLEAN NOT NULL);
CREATE TABLE context_annotations(visit_id INTEGER PRIMARY KEY,context_annotation_flags INTEGER NOT NULL,duration_since_last_visit INTEGER,page_end_reason INTEGER,total_foreground_duration INTEGER,browser_type INTEGER DEFAULT 0 NOT NULL,window_id INTEGER DEFAULT -1 NOT NULL,tab_id INTEGER DEFAULT -1 NOT NULL,task_id INTEGER DEFAULT -1 NOT NULL,root_task_id INTEGER DEFAULT -1 NOT NULL,parent_task_id INTEGER DEFAULT -1 NOT NULL,response_code INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE downloads (id INTEGER PRIMARY KEY,guid VARCHAR NOT NULL,current_path LONGVARCHAR NOT NULL,target_path LONGVARCHAR NOT NULL,start_time INTEGER NOT NULL,received_bytes INTEGER NOT NULL,total_bytes INTEGER NOT NULL,state INTEGER NOT NULL,danger_type INTEGER NOT NULL,interrupt_reason INTEGER NOT NULL,hash BLOB NOT NULL,end_time INTEGER NOT NULL,opened INTEGER NOT NULL,last_access_time INTEGER NOT NULL,transient INTEGER NOT NULL,referrer VARCHAR NOT NULL,site_url VARCHAR NOT NULL,embedder_download_data VARCHAR NOT NULL,tab_url VARCHAR NOT NULL,tab_referrer_url VARCHAR NOT NULL,http_method VARCHAR NOT NULL,by_ext_id VARCHAR NOT NULL,by_ext_name VARCHAR NOT NULL,by_web_app_id VARCHAR NOT NULL,etag VARCHAR NOT NULL,last_modified VARCHAR NOT NULL,mime_type VARCHAR(255) NOT NULL,original_mime_type VARCHAR(255) NOT NULL);
CREATE TABLE downloads_slices (download_id INTEGER NOT NULL,offset INTEGER NOT NULL,received_bytes INTEGER NOT NULL,finished INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (download_id, offset) );
CREATE TABLE downloads_url_chains (id INTEGER NOT NULL,chain_index INTEGER NOT NULL,url LONGVARCHAR NOT NULL, PRIMARY KEY (id, chain_index) );
CREATE TABLE history_sync_metadata (storage_key INTEGER PRIMARY KEY NOT NULL, value BLOB);
CREATE TABLE keyword_search_terms (keyword_id INTEGER NOT NULL,url_id INTEGER NOT NULL,term LONGVARCHAR NOT NULL,normalized_term LONGVARCHAR NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE segment_usage (id INTEGER PRIMARY KEY,segment_id INTEGER NOT NULL,time_slot INTEGER NOT NULL,visit_count INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE segments (id INTEGER PRIMARY KEY,name VARCHAR,url_id INTEGER NON NULL);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE visit_source(id INTEGER PRIMARY KEY,source INTEGER NOT NULL);
CREATE TABLE visited_links(id INTEGER PRIMARY KEY AUTOINCREMENT,link_url_id INTEGER NOT NULL,top_level_url LONGVARCHAR NOT NULL,frame_url LONGVARCHAR NOT NULL,visit_count INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,url INTEGER NOT NULL,visit_time INTEGER NOT NULL,from_visit INTEGER,external_referrer_url TEXT,transition INTEGER DEFAULT 0 NOT NULL,segment_id INTEGER,visit_duration INTEGER DEFAULT 0 NOT NULL,incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,opener_visit INTEGER,originator_cache_guid TEXT,originator_visit_id INTEGER,originator_from_visit INTEGER,originator_opener_visit INTEGER,is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,visited_link_id INTEGER DEFAULT 0 NOT NULL,app_id TEXT);
CREATE INDEX cluster_keywords_cluster_id_index ON cluster_keywords(cluster_id);
CREATE INDEX clusters_for_visit ON clusters_and_visits(visit_id);
CREATE INDEX keyword_search_terms_index1 ON keyword_search_terms (keyword_id, normalized_term);
CREATE INDEX keyword_search_terms_index2 ON keyword_search_terms (url_id);
CREATE INDEX keyword_search_terms_index3 ON keyword_search_terms (term);
CREATE INDEX segment_usage_time_slot_segment_id ON segment_usage(time_slot, segment_id);
CREATE INDEX segments_name ON segments(name);
CREATE INDEX segments_url_id ON segments(url_id);
CREATE INDEX segments_usage_seg_id ON segment_usage(segment_id);
CREATE INDEX urls_url_index ON urls (url);
CREATE INDEX visited_links_index ON visited_links (link_url_id, top_level_url, frame_url);
CREATE INDEX visits_from_index ON visits (from_visit);
CREATE INDEX visits_originator_id_index ON visits (originator_visit_id);
CREATE INDEX visits_time_index ON visits (visit_time);
CREATE INDEX visits_url_index ON visits (url);

==============================================================================
-- Profile 1/Login Data
-- meta: {"mmap_status": "-1", "version": "43", "last_compatible_version": "40"}
-- rows: {"insecure_credentials": 0, "logins": 0, "meta": 3, "password_notes": 0, "sqlite_sequence": 0, "stats": 0, "sync_entities_metadata": 0, "sync_model_metadata": 0}
==============================================================================
CREATE TABLE insecure_credentials (parent_id INTEGER REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, insecurity_type INTEGER NOT NULL, create_time INTEGER NOT NULL, is_muted INTEGER NOT NULL DEFAULT 0, trigger_notification_from_backend INTEGER NOT NULL DEFAULT 0, UNIQUE (parent_id, insecurity_type));
CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER, times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR, skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB, id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB, date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR, date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE password_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, key VARCHAR NOT NULL, value BLOB, date_created INTEGER NOT NULL, confidential INTEGER, UNIQUE (parent_id, key));
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE stats (origin_domain VARCHAR NOT NULL, username_value VARCHAR, dismissal_count INTEGER, update_time INTEGER NOT NULL, UNIQUE(origin_domain, username_value));
CREATE TABLE sync_entities_metadata (storage_key INTEGER PRIMARY KEY AUTOINCREMENT, metadata VARCHAR NOT NULL);
CREATE TABLE sync_model_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, model_metadata VARCHAR NOT NULL);
CREATE INDEX foreign_key_index ON insecure_credentials (parent_id);
CREATE INDEX foreign_key_index_notes ON password_notes (parent_id);
CREATE INDEX logins_signon ON logins (signon_realm);
CREATE INDEX stats_origin ON stats(origin_domain);

==============================================================================
-- Profile 1/Login Data For Account
-- meta: {"mmap_status": "-1", "version": "43", "last_compatible_version": "40"}
-- rows: {"insecure_credentials": 0, "logins": 0, "meta": 3, "password_notes": 0, "sqlite_sequence": 0, "stats": 0, "sync_entities_metadata": 0, "sync_model_metadata": 0}
==============================================================================
CREATE TABLE insecure_credentials (parent_id INTEGER REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, insecurity_type INTEGER NOT NULL, create_time INTEGER NOT NULL, is_muted INTEGER NOT NULL DEFAULT 0, trigger_notification_from_backend INTEGER NOT NULL DEFAULT 0, UNIQUE (parent_id, insecurity_type));
CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER, times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR, skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB, id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB, date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR, date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE password_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, key VARCHAR NOT NULL, value BLOB, date_created INTEGER NOT NULL, confidential INTEGER, UNIQUE (parent_id, key));
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE stats (origin_domain VARCHAR NOT NULL, username_value VARCHAR, dismissal_count INTEGER, update_time INTEGER NOT NULL, UNIQUE(origin_domain, username_value));
CREATE TABLE sync_entities_metadata (storage_key INTEGER PRIMARY KEY AUTOINCREMENT, metadata VARCHAR NOT NULL);
CREATE TABLE sync_model_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, model_metadata VARCHAR NOT NULL);
CREATE INDEX foreign_key_index ON insecure_credentials (parent_id);
CREATE INDEX foreign_key_index_notes ON password_notes (parent_id);
CREATE INDEX logins_signon ON logins (signon_realm);
CREATE INDEX stats_origin ON stats(origin_domain);

==============================================================================
-- Profile 1/Network Action Predictor
-- meta: {}
-- rows: {"lcp_critical_path_predictor": 0, "lcp_critical_path_predictor_initiator_origin": 0, "network_action_predictor": 0, "resource_prefetch_predictor_host_redirect": 1, "resource_prefetch_predictor_metadata": 1, "resource_prefetch_predictor_origin": 1}
==============================================================================
CREATE TABLE lcp_critical_path_predictor ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE lcp_critical_path_predictor_initiator_origin ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE network_action_predictor(id TEXT PRIMARY KEY, user_text TEXT, url TEXT, number_of_hits INTEGER, number_of_misses INTEGER);
CREATE TABLE resource_prefetch_predictor_host_redirect ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE resource_prefetch_predictor_metadata ( key TEXT, value INTEGER, PRIMARY KEY (key));
CREATE TABLE resource_prefetch_predictor_origin ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Profile 1/Reporting and NEL
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "nel_policies": 0, "reporting_endpoint_groups": 3, "reporting_endpoints": 3}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE nel_policies (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  received_ip_address TEXT NOT NULL,  group_name TEXT NOT NULL,  expires_us_since_epoch INTEGER NOT NULL,  success_fraction REAL NOT NULL,  failure_fraction REAL NOT NULL,  is_include_subdomains INTEGER NOT NULL,  last_access_us_since_epoch INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, nik));
CREATE TABLE reporting_endpoint_groups (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  group_name TEXT NOT NULL,  is_include_subdomains INTEGER NOT NULL,  expires_us_since_epoch INTEGER NOT NULL,  last_access_us_since_epoch INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, group_name, nik));
CREATE TABLE reporting_endpoints (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  group_name TEXT NOT NULL,  url TEXT NOT NULL,  priority INTEGER NOT NULL,  weight INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, group_name, url, nik));

==============================================================================
-- Profile 1/ServerCertificate
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"certificates": 0, "meta": 3}
==============================================================================
CREATE TABLE certificates(sha256hash_hex TEXT PRIMARY KEY,der_cert BLOB NOT NULL,trust_settings BLOB NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);

==============================================================================
-- Profile 1/Shortcuts
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "1"}
-- rows: {"meta": 3, "omni_box_shortcuts": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE omni_box_shortcuts(id VARCHAR PRIMARY KEY,text VARCHAR,fill_into_edit VARCHAR,url VARCHAR,document_type INTEGER,contents VARCHAR,contents_class VARCHAR,description VARCHAR,description_class VARCHAR,transition INTEGER,type INTEGER,keyword VARCHAR,last_access_time INTEGER,number_of_hits INTEGER);

==============================================================================
-- Profile 1/Top Sites
-- meta: {"mmap_status": "-1", "version": "5", "last_compatible_version": "5"}
-- rows: {"meta": 3, "top_sites": 1}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE top_sites(url TEXT NOT NULL PRIMARY KEY,url_rank INTEGER NOT NULL,title TEXT NOT NULL);

==============================================================================
-- Profile 1/Trust Tokens
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "trust_tokens_issuer_config": 0, "trust_tokens_issuer_toplevel_pair_config": 0, "trust_tokens_toplevel_config": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE trust_tokens_issuer_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_issuer_toplevel_pair_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_toplevel_config ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Profile 1/Web Data
-- meta: {"mmap_status": "-1", "version": "152", "last_compatible_version": "151", "Builtin Keyword Version": "209", "Builtin Keyword Country": "21323", "Is Prepopulated Engines Migration Enabled": "0", "Starter Pack Keyword Version": "13"}
-- rows: {"address_type_tokens": 0, "addresses": 0, "autofill": 0, "autofill_ai_attributes": 0, "autofill_ai_entities": 0, "autofill_ai_entities_metadata": 0, "autofill_model_type_state": 0, "autofill_sync_metadata": 0, "benefit_merchant_domains": 0, "credit_cards": 0, "generic_payment_instruments": 0, "keywords": 14, "local_ibans": 0, "local_stored_cvc": 0, "loyalty_card_merchant_domain": 0, "loyalty_cards": 0, "masked_bank_accounts": 0, "masked_bank_accounts_metadata": 0, "masked_credit_card_benefits": 0, "masked_credit_cards": 0, "masked_ibans": 0, "masked_ibans_metadata": 0, "meta": 7, "offer_data": 0, "offer_eligible_instrument": 0, "offer_merchant_domain": 0, "payment_instrument_creation_options": 0, "payment_method_manifest": 0, "payments_customer_data": 0, "plus_address_sync_entity_metadata": 0, "plus_address_sync_model_type_state": 0, "plus_addresses": 0, "secure_payment_confirmation_browser_bound_key": 0, "secure_payment_confirmation_instrument": 0, "server_card_cloud_token_data": 0, "server_card_metadata": 0, "server_stored_cvc": 0, "token_service": 0, "valuables_metadata": 0, "virtual_card_usage_data": 0, "web_app_manifest_section": 0}
==============================================================================
CREATE TABLE address_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER DEFAULT 0, observations BLOB, PRIMARY KEY (guid, type));
CREATE TABLE addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, date_modified INTEGER NOT NULL DEFAULT 0, language_code VARCHAR, label VARCHAR, initial_creator_id INTEGER DEFAULT 0, record_type INTEGER);
CREATE TABLE autofill (name VARCHAR, value VARCHAR, value_lower VARCHAR, date_created INTEGER DEFAULT 0, date_last_used INTEGER DEFAULT 0, count INTEGER DEFAULT 1, PRIMARY KEY (name, value));
CREATE TABLE autofill_ai_attributes (entity_guid TEXT NOT NULL, attribute_type TEXT NOT NULL, field_type INTEGER NOT NULL, value_encrypted BLOB NOT NULL, verification_status INTEGER NOT NULL, PRIMARY KEY (entity_guid, attribute_type, field_type));
CREATE TABLE autofill_ai_entities (guid TEXT NOT NULL PRIMARY KEY, entity_type TEXT NOT NULL, nickname TEXT NOT NULL, record_type INTEGER DEFAULT 0, attributes_read_only INTEGER DEFAULT 0, frecency_override TEXT NOT NULL DEFAULT '');
CREATE TABLE autofill_ai_entities_metadata (entity_guid TEXT NOT NULL PRIMARY KEY, use_count INTEGER DEFAULT 0, use_date INTEGER DEFAULT 0, date_modified INTEGER NOT NULL);
CREATE TABLE autofill_model_type_state (model_type INTEGER NOT NULL PRIMARY KEY, value BLOB);
CREATE TABLE autofill_sync_metadata (model_type INTEGER NOT NULL, storage_key VARCHAR NOT NULL, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE benefit_merchant_domains (benefit_id VARCHAR NOT NULL, merchant_domain VARCHAR NOT NULL);
CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER NOT NULL DEFAULT 0, origin VARCHAR DEFAULT '', use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR, nickname VARCHAR);
CREATE TABLE generic_payment_instruments (instrument_id INTEGER PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE keywords (id INTEGER PRIMARY KEY,short_name VARCHAR NOT NULL,keyword VARCHAR NOT NULL,favicon_url VARCHAR NOT NULL,url VARCHAR NOT NULL,safe_for_autoreplace INTEGER,originating_url VARCHAR,date_created INTEGER DEFAULT 0,usage_count INTEGER DEFAULT 0,input_encodings VARCHAR,suggest_url VARCHAR,prepopulate_id INTEGER DEFAULT 0,created_by_policy INTEGER DEFAULT 0,last_modified INTEGER DEFAULT 0,sync_guid VARCHAR,alternate_urls VARCHAR,image_url VARCHAR,search_url_post_params VARCHAR,suggest_url_post_params VARCHAR,image_url_post_params VARCHAR,new_tab_url VARCHAR,last_visited INTEGER DEFAULT 0, created_from_play_api INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, starter_pack_id INTEGER DEFAULT 0, enforced_by_policy INTEGER DEFAULT 0, featured_by_policy INTEGER DEFAULT 0, url_hash BLOB);
CREATE TABLE local_ibans (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, value_encrypted VARCHAR, nickname VARCHAR);
CREATE TABLE local_stored_cvc (guid VARCHAR PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE loyalty_card_merchant_domain (loyalty_card_id VARCHAR, merchant_domain VARCHAR);
CREATE TABLE loyalty_cards (loyalty_card_id TEXT PRIMARY KEY NOT NULL, merchant_name TEXT NOT NULL, program_name TEXT NOT NULL, program_logo TEXT NOT NULL, loyalty_card_number TEXT NOT NULL);
CREATE TABLE masked_bank_accounts (instrument_id INTEGER PRIMARY KEY NOT NULL, bank_name VARCHAR, account_number_suffix VARCHAR, account_type INTEGER DEFAULT 0, display_icon_url VARCHAR, nickname VARCHAR);
CREATE TABLE masked_bank_accounts_metadata (instrument_id INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE masked_credit_card_benefits (benefit_id VARCHAR PRIMARY KEY NOT NULL, instrument_id INTEGER NOT NULL DEFAULT 0, benefit_type INTEGER NOT NULL DEFAULT 0, benefit_category INTEGER NOT NULL DEFAULT 0, benefit_description VARCHAR NOT NULL, start_time INTEGER, end_time INTEGER);
CREATE TABLE masked_credit_cards (id VARCHAR, name_on_card VARCHAR, network VARCHAR, last_four VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, bank_name VARCHAR, nickname VARCHAR, card_issuer INTEGER DEFAULT 0, instrument_id INTEGER DEFAULT 0, virtual_card_enrollment_state INTEGER DEFAULT 0, card_art_url VARCHAR, product_description VARCHAR, card_issuer_id VARCHAR, virtual_card_enrollment_type INTEGER DEFAULT 0, product_terms_url VARCHAR, card_info_retrieval_enrollment_state INTEGER DEFAULT 0, card_benefit_source INTEGER DEFAULT 0, card_creation_source INTEGER DEFAULT 0);
CREATE TABLE masked_ibans (instrument_id VARCHAR PRIMARY KEY NOT NULL, prefix VARCHAR NOT NULL, suffix VARCHAR NOT NULL, nickname VARCHAR);
CREATE TABLE masked_ibans_metadata (instrument_id VARCHAR PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE offer_data (offer_id UNSIGNED LONG, offer_reward_amount VARCHAR, expiry UNSIGNED LONG, offer_details_url VARCHAR, merchant_domain VARCHAR, promo_code VARCHAR, value_prop_text VARCHAR, see_details_text VARCHAR, usage_instructions_text VARCHAR);
CREATE TABLE offer_eligible_instrument (offer_id UNSIGNED LONG, instrument_id UNSIGNED LONG);
CREATE TABLE offer_merchant_domain (offer_id UNSIGNED LONG, merchant_domain VARCHAR);
CREATE TABLE payment_instrument_creation_options (id VARCHAR PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE payment_method_manifest ( expire_date INTEGER NOT NULL DEFAULT 0, method_name VARCHAR, web_app_id VARCHAR);
CREATE TABLE payments_customer_data (customer_id VARCHAR);
CREATE TABLE plus_address_sync_entity_metadata (model_type INTEGER, storage_key VARCHAR, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE plus_address_sync_model_type_state (model_type INTEGER PRIMARY KEY, value BLOB);
CREATE TABLE plus_addresses (profile_id VARCHAR PRIMARY KEY, facet VARCHAR, plus_address VARCHAR);
CREATE TABLE secure_payment_confirmation_browser_bound_key ( credential_id BLOB NOT NULL, relying_party_id TEXT NOT NULL, browser_bound_key_id BLOB, last_used TIMESTAMP, PRIMARY KEY (credential_id, relying_party_id));
CREATE TABLE secure_payment_confirmation_instrument ( credential_id BLOB NOT NULL PRIMARY KEY, relying_party_id VARCHAR NOT NULL, label VARCHAR NOT NULL, icon BLOB NOT NULL, date_created INTEGER NOT NULL DEFAULT 0, user_id BLOB);
CREATE TABLE server_card_cloud_token_data (id VARCHAR, suffix VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, card_art_url VARCHAR, instrument_token VARCHAR);
CREATE TABLE server_card_metadata (id VARCHAR NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR);
CREATE TABLE server_stored_cvc (instrument_id INTEGER PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE token_service (service VARCHAR PRIMARY KEY NOT NULL,encrypted_token BLOB,binding_key BLOB,mtls_token_binding INTEGER);
CREATE TABLE valuables_metadata (valuable_id TEXT PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE virtual_card_usage_data (id VARCHAR PRIMARY KEY, instrument_id INTEGER DEFAULT 0, merchant_domain VARCHAR, last_four VARCHAR);
CREATE TABLE web_app_manifest_section ( expire_date INTEGER NOT NULL DEFAULT 0, id VARCHAR, min_version INTEGER NOT NULL DEFAULT 0, fingerprints BLOB);
CREATE INDEX autofill_name ON autofill(name);
CREATE INDEX autofill_name_value_lower ON autofill(name, value_lower);

==============================================================================
-- Profile 1/declarative_performance_observer.db
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"declarative_performance_observer_policies": 0, "declarative_performance_observer_reports": 0, "meta": 3, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE declarative_performance_observer_policies (origin TEXT PRIMARY KEY NOT NULL, capture_early_failures BOOLEAN NOT NULL);
CREATE TABLE declarative_performance_observer_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_reports_origin ON declarative_performance_observer_reports(origin);

==============================================================================
-- Profile 1/heavy_ad_intervention_opt_out.db
-- meta: {}
-- rows: {"enabled_previews_v1": 1, "previews_v1": 0}
==============================================================================
CREATE TABLE enabled_previews_v1 (type INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(type));
CREATE TABLE previews_v1 (host_name VARCHAR NOT NULL, time INTEGER NOT NULL, opt_out INTEGER NOT NULL, type INTEGER NOT NULL, PRIMARY KEY(host_name, time DESC, opt_out, type));

==============================================================================
-- Profile 1/WebStorage/QuotaManager
-- meta: {"mmap_status": "-1", "version": "11", "last_compatible_version": "11", "IsBucketsBootstrapped": "1", "IsMediaLicenseDatabaseRemoved": "1"}
-- rows: {"buckets": 2, "meta": 5, "sqlite_sequence": 1}
==============================================================================
CREATE TABLE buckets(id INTEGER PRIMARY KEY AUTOINCREMENT, storage_key TEXT NOT NULL, host TEXT NOT NULL, name TEXT NOT NULL, use_count INTEGER NOT NULL, last_accessed INTEGER NOT NULL, last_modified INTEGER NOT NULL, expiration INTEGER NOT NULL, quota INTEGER NOT NULL, persistent INTEGER NOT NULL, durability INTEGER NOT NULL) STRICT;
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX buckets_by_expiration ON buckets(expiration);
CREATE INDEX buckets_by_host ON buckets(host);
CREATE INDEX buckets_by_last_accessed ON buckets(last_accessed);
CREATE INDEX buckets_by_last_modified ON buckets(last_modified);
CREATE UNIQUE INDEX buckets_by_storage_key ON buckets(storage_key, name);

==============================================================================
-- Profile 1/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Trust Tokens
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "trust_tokens_issuer_config": 0, "trust_tokens_issuer_toplevel_pair_config": 0, "trust_tokens_toplevel_config": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE trust_tokens_issuer_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_issuer_toplevel_pair_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_toplevel_config ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Profile 1/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/declarative_performance_observer.db
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"declarative_performance_observer_policies": 0, "declarative_performance_observer_reports": 0, "meta": 3, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE declarative_performance_observer_policies (origin TEXT PRIMARY KEY NOT NULL, capture_early_failures BOOLEAN NOT NULL);
CREATE TABLE declarative_performance_observer_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_reports_origin ON declarative_performance_observer_reports(origin);

==============================================================================
-- Profile 1/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Shared Dictionary/db
-- meta: {"mmap_status": "-1", "version": "4", "last_compatible_version": "4", "total_dict_size": "0"}
-- rows: {"dictionaries": 0, "meta": 4, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE dictionaries(primary_key INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,frame_origin TEXT NOT NULL,top_frame_site TEXT NOT NULL,host TEXT NOT NULL,match TEXT NOT NULL,match_dest TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,last_fetch_time INTEGER NOT NULL,res_time INTEGER NOT NULL,exp_time INTEGER NOT NULL,last_used_time INTEGER NOT NULL,size INTEGER NOT NULL,sha256 BLOB NOT NULL,token_high INTEGER NOT NULL,token_low INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX exp_time_index ON dictionaries(exp_time);
CREATE INDEX isolation_index ON dictionaries(frame_origin,top_frame_site);
CREATE INDEX last_used_time_index ON dictionaries(last_used_time);
CREATE INDEX token_index ON dictionaries(token_high, token_low);
CREATE INDEX top_frame_site_index ON dictionaries(top_frame_site);
CREATE UNIQUE INDEX unique_index ON dictionaries(frame_origin,top_frame_site,host,match,match_dest);

==============================================================================
-- Profile 1/Shared Dictionary/db
-- meta: {"mmap_status": "-1", "version": "4", "last_compatible_version": "4", "total_dict_size": "0"}
-- rows: {"dictionaries": 0, "meta": 4, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE dictionaries(primary_key INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,frame_origin TEXT NOT NULL,top_frame_site TEXT NOT NULL,host TEXT NOT NULL,match TEXT NOT NULL,match_dest TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,last_fetch_time INTEGER NOT NULL,res_time INTEGER NOT NULL,exp_time INTEGER NOT NULL,last_used_time INTEGER NOT NULL,size INTEGER NOT NULL,sha256 BLOB NOT NULL,token_high INTEGER NOT NULL,token_low INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX exp_time_index ON dictionaries(exp_time);
CREATE INDEX isolation_index ON dictionaries(frame_origin,top_frame_site);
CREATE INDEX last_used_time_index ON dictionaries(last_used_time);
CREATE INDEX token_index ON dictionaries(token_high, token_low);
CREATE INDEX top_frame_site_index ON dictionaries(top_frame_site);
CREATE UNIQUE INDEX unique_index ON dictionaries(frame_origin,top_frame_site,host,match,match_dest);

==============================================================================
-- Default/Account Web Data
-- meta: {"mmap_status": "-1", "version": "152", "last_compatible_version": "151"}
-- rows: {"autofill_model_type_state": 0, "autofill_sync_metadata": 0, "benefit_merchant_domains": 0, "credit_cards": 0, "generic_payment_instruments": 0, "local_ibans": 0, "local_stored_cvc": 0, "masked_bank_accounts": 0, "masked_bank_accounts_metadata": 0, "masked_credit_card_benefits": 0, "masked_credit_cards": 0, "masked_ibans": 0, "masked_ibans_metadata": 0, "meta": 3, "offer_data": 0, "offer_eligible_instrument": 0, "offer_merchant_domain": 0, "payment_instrument_creation_options": 0, "payments_customer_data": 0, "server_card_cloud_token_data": 0, "server_card_metadata": 0, "server_stored_cvc": 0, "virtual_card_usage_data": 0}
==============================================================================
CREATE TABLE autofill_model_type_state (model_type INTEGER NOT NULL PRIMARY KEY, value BLOB);
CREATE TABLE autofill_sync_metadata (model_type INTEGER NOT NULL, storage_key VARCHAR NOT NULL, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE benefit_merchant_domains (benefit_id VARCHAR NOT NULL, merchant_domain VARCHAR NOT NULL);
CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER NOT NULL DEFAULT 0, origin VARCHAR DEFAULT '', use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR, nickname VARCHAR);
CREATE TABLE generic_payment_instruments (instrument_id INTEGER PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE local_ibans (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, value_encrypted VARCHAR, nickname VARCHAR);
CREATE TABLE local_stored_cvc (guid VARCHAR PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE masked_bank_accounts (instrument_id INTEGER PRIMARY KEY NOT NULL, bank_name VARCHAR, account_number_suffix VARCHAR, account_type INTEGER DEFAULT 0, display_icon_url VARCHAR, nickname VARCHAR);
CREATE TABLE masked_bank_accounts_metadata (instrument_id INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE masked_credit_card_benefits (benefit_id VARCHAR PRIMARY KEY NOT NULL, instrument_id INTEGER NOT NULL DEFAULT 0, benefit_type INTEGER NOT NULL DEFAULT 0, benefit_category INTEGER NOT NULL DEFAULT 0, benefit_description VARCHAR NOT NULL, start_time INTEGER, end_time INTEGER);
CREATE TABLE masked_credit_cards (id VARCHAR, name_on_card VARCHAR, network VARCHAR, last_four VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, bank_name VARCHAR, nickname VARCHAR, card_issuer INTEGER DEFAULT 0, instrument_id INTEGER DEFAULT 0, virtual_card_enrollment_state INTEGER DEFAULT 0, card_art_url VARCHAR, product_description VARCHAR, card_issuer_id VARCHAR, virtual_card_enrollment_type INTEGER DEFAULT 0, product_terms_url VARCHAR, card_info_retrieval_enrollment_state INTEGER DEFAULT 0, card_benefit_source INTEGER DEFAULT 0, card_creation_source INTEGER DEFAULT 0);
CREATE TABLE masked_ibans (instrument_id VARCHAR PRIMARY KEY NOT NULL, prefix VARCHAR NOT NULL, suffix VARCHAR NOT NULL, nickname VARCHAR);
CREATE TABLE masked_ibans_metadata (instrument_id VARCHAR PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE offer_data (offer_id UNSIGNED LONG, offer_reward_amount VARCHAR, expiry UNSIGNED LONG, offer_details_url VARCHAR, merchant_domain VARCHAR, promo_code VARCHAR, value_prop_text VARCHAR, see_details_text VARCHAR, usage_instructions_text VARCHAR);
CREATE TABLE offer_eligible_instrument (offer_id UNSIGNED LONG, instrument_id UNSIGNED LONG);
CREATE TABLE offer_merchant_domain (offer_id UNSIGNED LONG, merchant_domain VARCHAR);
CREATE TABLE payment_instrument_creation_options (id VARCHAR PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE payments_customer_data (customer_id VARCHAR);
CREATE TABLE server_card_cloud_token_data (id VARCHAR, suffix VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, card_art_url VARCHAR, instrument_token VARCHAR);
CREATE TABLE server_card_metadata (id VARCHAR NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR);
CREATE TABLE server_stored_cvc (instrument_id INTEGER PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE virtual_card_usage_data (id VARCHAR PRIMARY KEY, instrument_id INTEGER DEFAULT 0, merchant_domain VARCHAR, last_four VARCHAR);

==============================================================================
-- Default/Affiliation Database
-- meta: {"mmap_status": "-1", "version": "7", "last_compatible_version": "1"}
-- rows: {"eq_class_groups": 0, "eq_class_members": 0, "eq_classes": 0, "meta": 3, "psl_extensions": 0, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE eq_class_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, facet_uri LONGVARCHAR NOT NULL, set_id INTEGER NOT NULL REFERENCES eq_classes(id) ON DELETE CASCADE, main_domain VARCHAR, change_password_url VARCHAR);
CREATE TABLE eq_class_members (id INTEGER PRIMARY KEY AUTOINCREMENT, facet_uri LONGVARCHAR NOT NULL, set_id INTEGER NOT NULL REFERENCES eq_classes(id) ON DELETE CASCADE, facet_display_name VARCHAR, facet_icon_url VARCHAR, change_password_url VARCHAR, UNIQUE (facet_uri));
CREATE TABLE eq_classes (id INTEGER PRIMARY KEY AUTOINCREMENT, last_update_time INTEGER, group_display_name VARCHAR, group_icon_url VARCHAR);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE psl_extensions (domain VARCHAR NOT NULL, UNIQUE (domain));
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX index_on_eq_class_members_set_id ON eq_class_members (set_id);
CREATE INDEX index_on_eq_groups_set_id_index ON eq_class_groups (set_id);
CREATE INDEX index_on_eq_groups_url_index ON eq_class_groups (facet_uri);

==============================================================================
-- Default/BrowsingTopicsSiteData
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"browsing_topics_api_hashed_to_unhashed_domain": 0, "browsing_topics_api_usages": 0, "meta": 3}
==============================================================================
CREATE TABLE browsing_topics_api_hashed_to_unhashed_domain(hashed_context_domain INTEGER PRIMARY KEY,context_domain TEXT NOT NULL);
CREATE TABLE browsing_topics_api_usages(hashed_context_domain INTEGER NOT NULL,hashed_main_frame_host INTEGER NOT NULL,last_usage_time INTEGER NOT NULL,PRIMARY KEY (hashed_context_domain,hashed_main_frame_host));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE INDEX last_usage_time_idx ON browsing_topics_api_usages(last_usage_time);

==============================================================================
-- Default/Cookies
-- meta: {"mmap_status": "-1", "version": "24", "last_compatible_version": "24"}
-- rows: {"cookies": 7, "meta": 3}
==============================================================================
CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,has_cross_site_ancestor INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port);

==============================================================================
-- Default/DIPS
-- meta: {"mmap_status": "-1", "version": "11", "last_compatible_version": "11"}
-- rows: {"bounces": 0, "config": 1, "meta": 3, "popups": 0}
==============================================================================
CREATE TABLE bounces(site TEXT PRIMARY KEY NOT NULL,first_user_activation_time INTEGER,last_user_activation_time INTEGER,first_bounce_time INTEGER,last_bounce_time INTEGER,first_web_authn_assertion_time INTEGER,last_web_authn_assertion_time INTEGER);
CREATE TABLE config(key TEXT NOT NULL,int_value INTEGER,PRIMARY KEY (`key`));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE popups(opener_site TEXT NOT NULL,popup_site TEXT NOT NULL,access_id INT64,last_popup_time INTEGER,is_current_interaction BOOLEAN,is_authentication_interaction BOOLEAN,PRIMARY KEY (`opener_site`,`popup_site`));

==============================================================================
-- Default/Favicons
-- meta: {"mmap_status": "-1", "version": "9", "last_compatible_version": "9"}
-- rows: {"favicon_bitmaps": 6, "favicons": 3, "icon_mapping": 3, "meta": 3}
==============================================================================
CREATE TABLE favicon_bitmaps(id INTEGER PRIMARY KEY,icon_id INTEGER NOT NULL,last_updated INTEGER DEFAULT 0,image_data BLOB,width INTEGER DEFAULT 0,height INTEGER DEFAULT 0,last_requested INTEGER DEFAULT 0);
CREATE TABLE favicons(id INTEGER PRIMARY KEY,url LONGVARCHAR NOT NULL,icon_type INTEGER DEFAULT 1);
CREATE TABLE icon_mapping(id INTEGER PRIMARY KEY,page_url LONGVARCHAR NOT NULL,icon_id INTEGER,page_url_type INTEGER DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE INDEX favicon_bitmaps_icon_id ON favicon_bitmaps(icon_id);
CREATE INDEX favicons_url ON favicons(url);
CREATE INDEX icon_mapping_icon_id_idx ON icon_mapping(icon_id);
CREATE INDEX icon_mapping_page_url_idx ON icon_mapping(page_url);

==============================================================================
-- Default/History
-- meta: {"mmap_status": "-1", "version": "70", "last_compatible_version": "16", "early_expiration_threshold": "13422663071195218"}
-- rows: {"cluster_keywords": 0, "cluster_visit_duplicates": 0, "clusters": 0, "clusters_and_visits": 0, "content_annotations": 5, "context_annotations": 5, "downloads": 0, "downloads_slices": 0, "downloads_url_chains": 0, "history_sync_metadata": 0, "keyword_search_terms": 0, "meta": 4, "segment_usage": 0, "segments": 0, "sqlite_sequence": 2, "urls": 6, "visit_source": 0, "visited_links": 0, "visits": 6}
==============================================================================
CREATE TABLE cluster_keywords(cluster_id INTEGER NOT NULL,keyword VARCHAR NOT NULL,type INTEGER NOT NULL,score NUMERIC NOT NULL,collections VARCHAR NOT NULL);
CREATE TABLE cluster_visit_duplicates(visit_id INTEGER NOT NULL,duplicate_visit_id INTEGER NOT NULL,PRIMARY KEY(visit_id,duplicate_visit_id))WITHOUT ROWID;
CREATE TABLE clusters(cluster_id INTEGER PRIMARY KEY AUTOINCREMENT,should_show_on_prominent_ui_surfaces BOOLEAN NOT NULL,label VARCHAR NOT NULL,raw_label VARCHAR NOT NULL,triggerability_calculated BOOLEAN NOT NULL,originator_cache_guid TEXT NOT NULL,originator_cluster_id INTEGER NOT NULL);
CREATE TABLE clusters_and_visits(cluster_id INTEGER NOT NULL,visit_id INTEGER NOT NULL,score NUMERIC DEFAULT 0 NOT NULL,engagement_score NUMERIC DEFAULT 0 NOT NULL,url_for_deduping LONGVARCHAR NOT NULL,normalized_url LONGVARCHAR NOT NULL,url_for_display LONGVARCHAR NOT NULL,interaction_state INTEGER DEFAULT 0 NOT NULL,PRIMARY KEY(cluster_id,visit_id))WITHOUT ROWID;
CREATE TABLE content_annotations(visit_id INTEGER PRIMARY KEY,visibility_score NUMERIC,floc_protected_score NUMERIC,categories VARCHAR,page_topics_model_version INTEGER,annotation_flags INTEGER NOT NULL,entities VARCHAR,related_searches VARCHAR,search_normalized_url VARCHAR,search_terms LONGVARCHAR,alternative_title VARCHAR,page_language VARCHAR,password_state INTEGER DEFAULT 0 NOT NULL,has_url_keyed_image BOOLEAN NOT NULL);
CREATE TABLE context_annotations(visit_id INTEGER PRIMARY KEY,context_annotation_flags INTEGER NOT NULL,duration_since_last_visit INTEGER,page_end_reason INTEGER,total_foreground_duration INTEGER,browser_type INTEGER DEFAULT 0 NOT NULL,window_id INTEGER DEFAULT -1 NOT NULL,tab_id INTEGER DEFAULT -1 NOT NULL,task_id INTEGER DEFAULT -1 NOT NULL,root_task_id INTEGER DEFAULT -1 NOT NULL,parent_task_id INTEGER DEFAULT -1 NOT NULL,response_code INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE downloads (id INTEGER PRIMARY KEY,guid VARCHAR NOT NULL,current_path LONGVARCHAR NOT NULL,target_path LONGVARCHAR NOT NULL,start_time INTEGER NOT NULL,received_bytes INTEGER NOT NULL,total_bytes INTEGER NOT NULL,state INTEGER NOT NULL,danger_type INTEGER NOT NULL,interrupt_reason INTEGER NOT NULL,hash BLOB NOT NULL,end_time INTEGER NOT NULL,opened INTEGER NOT NULL,last_access_time INTEGER NOT NULL,transient INTEGER NOT NULL,referrer VARCHAR NOT NULL,site_url VARCHAR NOT NULL,embedder_download_data VARCHAR NOT NULL,tab_url VARCHAR NOT NULL,tab_referrer_url VARCHAR NOT NULL,http_method VARCHAR NOT NULL,by_ext_id VARCHAR NOT NULL,by_ext_name VARCHAR NOT NULL,by_web_app_id VARCHAR NOT NULL,etag VARCHAR NOT NULL,last_modified VARCHAR NOT NULL,mime_type VARCHAR(255) NOT NULL,original_mime_type VARCHAR(255) NOT NULL);
CREATE TABLE downloads_slices (download_id INTEGER NOT NULL,offset INTEGER NOT NULL,received_bytes INTEGER NOT NULL,finished INTEGER NOT NULL DEFAULT 0,PRIMARY KEY (download_id, offset) );
CREATE TABLE downloads_url_chains (id INTEGER NOT NULL,chain_index INTEGER NOT NULL,url LONGVARCHAR NOT NULL, PRIMARY KEY (id, chain_index) );
CREATE TABLE history_sync_metadata (storage_key INTEGER PRIMARY KEY NOT NULL, value BLOB);
CREATE TABLE keyword_search_terms (keyword_id INTEGER NOT NULL,url_id INTEGER NOT NULL,term LONGVARCHAR NOT NULL,normalized_term LONGVARCHAR NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE segment_usage (id INTEGER PRIMARY KEY,segment_id INTEGER NOT NULL,time_slot INTEGER NOT NULL,visit_count INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE segments (id INTEGER PRIMARY KEY,name VARCHAR,url_id INTEGER NON NULL);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT,url LONGVARCHAR,title LONGVARCHAR,visit_count INTEGER DEFAULT 0 NOT NULL,typed_count INTEGER DEFAULT 0 NOT NULL,last_visit_time INTEGER NOT NULL,hidden INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE visit_source(id INTEGER PRIMARY KEY,source INTEGER NOT NULL);
CREATE TABLE visited_links(id INTEGER PRIMARY KEY AUTOINCREMENT,link_url_id INTEGER NOT NULL,top_level_url LONGVARCHAR NOT NULL,frame_url LONGVARCHAR NOT NULL,visit_count INTEGER DEFAULT 0 NOT NULL);
CREATE TABLE visits(id INTEGER PRIMARY KEY AUTOINCREMENT,url INTEGER NOT NULL,visit_time INTEGER NOT NULL,from_visit INTEGER,external_referrer_url TEXT,transition INTEGER DEFAULT 0 NOT NULL,segment_id INTEGER,visit_duration INTEGER DEFAULT 0 NOT NULL,incremented_omnibox_typed_score BOOLEAN DEFAULT FALSE NOT NULL,opener_visit INTEGER,originator_cache_guid TEXT,originator_visit_id INTEGER,originator_from_visit INTEGER,originator_opener_visit INTEGER,is_known_to_sync BOOLEAN DEFAULT FALSE NOT NULL,consider_for_ntp_most_visited BOOLEAN DEFAULT FALSE NOT NULL,visited_link_id INTEGER DEFAULT 0 NOT NULL,app_id TEXT);
CREATE INDEX cluster_keywords_cluster_id_index ON cluster_keywords(cluster_id);
CREATE INDEX clusters_for_visit ON clusters_and_visits(visit_id);
CREATE INDEX keyword_search_terms_index1 ON keyword_search_terms (keyword_id, normalized_term);
CREATE INDEX keyword_search_terms_index2 ON keyword_search_terms (url_id);
CREATE INDEX keyword_search_terms_index3 ON keyword_search_terms (term);
CREATE INDEX segment_usage_time_slot_segment_id ON segment_usage(time_slot, segment_id);
CREATE INDEX segments_name ON segments(name);
CREATE INDEX segments_url_id ON segments(url_id);
CREATE INDEX segments_usage_seg_id ON segment_usage(segment_id);
CREATE INDEX urls_url_index ON urls (url);
CREATE INDEX visited_links_index ON visited_links (link_url_id, top_level_url, frame_url);
CREATE INDEX visits_from_index ON visits (from_visit);
CREATE INDEX visits_originator_id_index ON visits (originator_visit_id);
CREATE INDEX visits_time_index ON visits (visit_time);
CREATE INDEX visits_url_index ON visits (url);

==============================================================================
-- Default/Login Data
-- meta: {"mmap_status": "-1", "version": "43", "last_compatible_version": "40"}
-- rows: {"insecure_credentials": 0, "logins": 0, "meta": 3, "password_notes": 0, "sqlite_sequence": 0, "stats": 0, "sync_entities_metadata": 0, "sync_model_metadata": 0}
==============================================================================
CREATE TABLE insecure_credentials (parent_id INTEGER REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, insecurity_type INTEGER NOT NULL, create_time INTEGER NOT NULL, is_muted INTEGER NOT NULL DEFAULT 0, trigger_notification_from_backend INTEGER NOT NULL DEFAULT 0, UNIQUE (parent_id, insecurity_type));
CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER, times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR, skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB, id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB, date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR, date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE password_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, key VARCHAR NOT NULL, value BLOB, date_created INTEGER NOT NULL, confidential INTEGER, UNIQUE (parent_id, key));
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE stats (origin_domain VARCHAR NOT NULL, username_value VARCHAR, dismissal_count INTEGER, update_time INTEGER NOT NULL, UNIQUE(origin_domain, username_value));
CREATE TABLE sync_entities_metadata (storage_key INTEGER PRIMARY KEY AUTOINCREMENT, metadata VARCHAR NOT NULL);
CREATE TABLE sync_model_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, model_metadata VARCHAR NOT NULL);
CREATE INDEX foreign_key_index ON insecure_credentials (parent_id);
CREATE INDEX foreign_key_index_notes ON password_notes (parent_id);
CREATE INDEX logins_signon ON logins (signon_realm);
CREATE INDEX stats_origin ON stats(origin_domain);

==============================================================================
-- Default/Login Data For Account
-- meta: {"mmap_status": "-1", "version": "43", "last_compatible_version": "40"}
-- rows: {"insecure_credentials": 0, "logins": 0, "meta": 3, "password_notes": 0, "sqlite_sequence": 0, "stats": 0, "sync_entities_metadata": 0, "sync_model_metadata": 0}
==============================================================================
CREATE TABLE insecure_credentials (parent_id INTEGER REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, insecurity_type INTEGER NOT NULL, create_time INTEGER NOT NULL, is_muted INTEGER NOT NULL DEFAULT 0, trigger_notification_from_backend INTEGER NOT NULL DEFAULT 0, UNIQUE (parent_id, insecurity_type));
CREATE TABLE logins (origin_url VARCHAR NOT NULL, action_url VARCHAR, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, submit_element VARCHAR, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, blacklisted_by_user INTEGER NOT NULL, scheme INTEGER NOT NULL, password_type INTEGER, times_used INTEGER, form_data BLOB, display_name VARCHAR, icon_url VARCHAR, federation_url VARCHAR, skip_zero_click INTEGER, generation_upload_status INTEGER, possible_username_pairs BLOB, id INTEGER PRIMARY KEY AUTOINCREMENT, date_last_used INTEGER NOT NULL DEFAULT 0, moving_blocked_for BLOB, date_password_modified INTEGER NOT NULL DEFAULT 0, sender_email VARCHAR, sender_name VARCHAR, date_received INTEGER, sharing_notification_displayed INTEGER NOT NULL DEFAULT 0, keychain_identifier BLOB, sender_profile_image_url VARCHAR, date_last_filled INTEGER NOT NULL DEFAULT 0, actor_login_approved INTEGER NOT NULL DEFAULT 0, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm));
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE password_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL REFERENCES logins ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, key VARCHAR NOT NULL, value BLOB, date_created INTEGER NOT NULL, confidential INTEGER, UNIQUE (parent_id, key));
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE stats (origin_domain VARCHAR NOT NULL, username_value VARCHAR, dismissal_count INTEGER, update_time INTEGER NOT NULL, UNIQUE(origin_domain, username_value));
CREATE TABLE sync_entities_metadata (storage_key INTEGER PRIMARY KEY AUTOINCREMENT, metadata VARCHAR NOT NULL);
CREATE TABLE sync_model_metadata (id INTEGER PRIMARY KEY AUTOINCREMENT, model_metadata VARCHAR NOT NULL);
CREATE INDEX foreign_key_index ON insecure_credentials (parent_id);
CREATE INDEX foreign_key_index_notes ON password_notes (parent_id);
CREATE INDEX logins_signon ON logins (signon_realm);
CREATE INDEX stats_origin ON stats(origin_domain);

==============================================================================
-- Default/Network Action Predictor
-- meta: {}
-- rows: {"lcp_critical_path_predictor": 0, "lcp_critical_path_predictor_initiator_origin": 0, "network_action_predictor": 0, "resource_prefetch_predictor_host_redirect": 2, "resource_prefetch_predictor_metadata": 1, "resource_prefetch_predictor_origin": 2}
==============================================================================
CREATE TABLE lcp_critical_path_predictor ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE lcp_critical_path_predictor_initiator_origin ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE network_action_predictor(id TEXT PRIMARY KEY, user_text TEXT, url TEXT, number_of_hits INTEGER, number_of_misses INTEGER);
CREATE TABLE resource_prefetch_predictor_host_redirect ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE resource_prefetch_predictor_metadata ( key TEXT, value INTEGER, PRIMARY KEY (key));
CREATE TABLE resource_prefetch_predictor_origin ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Default/Reporting and NEL
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "nel_policies": 1, "reporting_endpoint_groups": 2, "reporting_endpoints": 2}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE nel_policies (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  received_ip_address TEXT NOT NULL,  group_name TEXT NOT NULL,  expires_us_since_epoch INTEGER NOT NULL,  success_fraction REAL NOT NULL,  failure_fraction REAL NOT NULL,  is_include_subdomains INTEGER NOT NULL,  last_access_us_since_epoch INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, nik));
CREATE TABLE reporting_endpoint_groups (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  group_name TEXT NOT NULL,  is_include_subdomains INTEGER NOT NULL,  expires_us_since_epoch INTEGER NOT NULL,  last_access_us_since_epoch INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, group_name, nik));
CREATE TABLE reporting_endpoints (  nik TEXT NOT NULL,  origin_scheme TEXT NOT NULL,  origin_host TEXT NOT NULL,  origin_port INTEGER NOT NULL,  group_name TEXT NOT NULL,  url TEXT NOT NULL,  priority INTEGER NOT NULL,  weight INTEGER NOT NULL,  UNIQUE (origin_scheme, origin_host, origin_port, group_name, url, nik));

==============================================================================
-- Default/ServerCertificate
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"certificates": 0, "meta": 3}
==============================================================================
CREATE TABLE certificates(sha256hash_hex TEXT PRIMARY KEY,der_cert BLOB NOT NULL,trust_settings BLOB NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);

==============================================================================
-- Default/SharedStorage
-- meta: {}
-- rows: {}
==============================================================================
;

==============================================================================
-- Default/Shortcuts
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "1"}
-- rows: {"meta": 3, "omni_box_shortcuts": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE omni_box_shortcuts(id VARCHAR PRIMARY KEY,text VARCHAR,fill_into_edit VARCHAR,url VARCHAR,document_type INTEGER,contents VARCHAR,contents_class VARCHAR,description VARCHAR,description_class VARCHAR,transition INTEGER,type INTEGER,keyword VARCHAR,last_access_time INTEGER,number_of_hits INTEGER);

==============================================================================
-- Default/Top Sites
-- meta: {"mmap_status": "-1", "version": "5", "last_compatible_version": "5"}
-- rows: {"meta": 3, "top_sites": 1}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE top_sites(url TEXT NOT NULL PRIMARY KEY,url_rank INTEGER NOT NULL,title TEXT NOT NULL);

==============================================================================
-- Default/Trust Tokens
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "trust_tokens_issuer_config": 0, "trust_tokens_issuer_toplevel_pair_config": 0, "trust_tokens_toplevel_config": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE trust_tokens_issuer_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_issuer_toplevel_pair_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_toplevel_config ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Default/Web Data
-- meta: {"mmap_status": "-1", "version": "152", "last_compatible_version": "151", "Builtin Keyword Version": "209", "Builtin Keyword Country": "21323", "Is Prepopulated Engines Migration Enabled": "0", "Starter Pack Keyword Version": "13"}
-- rows: {"address_type_tokens": 0, "addresses": 0, "autofill": 0, "autofill_ai_attributes": 0, "autofill_ai_entities": 0, "autofill_ai_entities_metadata": 0, "autofill_model_type_state": 0, "autofill_sync_metadata": 0, "benefit_merchant_domains": 0, "credit_cards": 0, "generic_payment_instruments": 0, "keywords": 14, "local_ibans": 0, "local_stored_cvc": 0, "loyalty_card_merchant_domain": 0, "loyalty_cards": 0, "masked_bank_accounts": 0, "masked_bank_accounts_metadata": 0, "masked_credit_card_benefits": 0, "masked_credit_cards": 0, "masked_ibans": 0, "masked_ibans_metadata": 0, "meta": 7, "offer_data": 0, "offer_eligible_instrument": 0, "offer_merchant_domain": 0, "payment_instrument_creation_options": 0, "payment_method_manifest": 0, "payments_customer_data": 0, "plus_address_sync_entity_metadata": 0, "plus_address_sync_model_type_state": 0, "plus_addresses": 0, "secure_payment_confirmation_browser_bound_key": 0, "secure_payment_confirmation_instrument": 0, "server_card_cloud_token_data": 0, "server_card_metadata": 0, "server_stored_cvc": 0, "token_service": 0, "valuables_metadata": 0, "virtual_card_usage_data": 0, "web_app_manifest_section": 0}
==============================================================================
CREATE TABLE address_type_tokens (guid VARCHAR, type INTEGER, value VARCHAR, verification_status INTEGER DEFAULT 0, observations BLOB, PRIMARY KEY (guid, type));
CREATE TABLE addresses (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, date_modified INTEGER NOT NULL DEFAULT 0, language_code VARCHAR, label VARCHAR, initial_creator_id INTEGER DEFAULT 0, record_type INTEGER);
CREATE TABLE autofill (name VARCHAR, value VARCHAR, value_lower VARCHAR, date_created INTEGER DEFAULT 0, date_last_used INTEGER DEFAULT 0, count INTEGER DEFAULT 1, PRIMARY KEY (name, value));
CREATE TABLE autofill_ai_attributes (entity_guid TEXT NOT NULL, attribute_type TEXT NOT NULL, field_type INTEGER NOT NULL, value_encrypted BLOB NOT NULL, verification_status INTEGER NOT NULL, PRIMARY KEY (entity_guid, attribute_type, field_type));
CREATE TABLE autofill_ai_entities (guid TEXT NOT NULL PRIMARY KEY, entity_type TEXT NOT NULL, nickname TEXT NOT NULL, record_type INTEGER DEFAULT 0, attributes_read_only INTEGER DEFAULT 0, frecency_override TEXT NOT NULL DEFAULT '');
CREATE TABLE autofill_ai_entities_metadata (entity_guid TEXT NOT NULL PRIMARY KEY, use_count INTEGER DEFAULT 0, use_date INTEGER DEFAULT 0, date_modified INTEGER NOT NULL);
CREATE TABLE autofill_model_type_state (model_type INTEGER NOT NULL PRIMARY KEY, value BLOB);
CREATE TABLE autofill_sync_metadata (model_type INTEGER NOT NULL, storage_key VARCHAR NOT NULL, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE benefit_merchant_domains (benefit_id VARCHAR NOT NULL, merchant_domain VARCHAR NOT NULL);
CREATE TABLE credit_cards (guid VARCHAR PRIMARY KEY, name_on_card VARCHAR, expiration_month INTEGER, expiration_year INTEGER, card_number_encrypted BLOB, date_modified INTEGER NOT NULL DEFAULT 0, origin VARCHAR DEFAULT '', use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR, nickname VARCHAR);
CREATE TABLE generic_payment_instruments (instrument_id INTEGER PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE keywords (id INTEGER PRIMARY KEY,short_name VARCHAR NOT NULL,keyword VARCHAR NOT NULL,favicon_url VARCHAR NOT NULL,url VARCHAR NOT NULL,safe_for_autoreplace INTEGER,originating_url VARCHAR,date_created INTEGER DEFAULT 0,usage_count INTEGER DEFAULT 0,input_encodings VARCHAR,suggest_url VARCHAR,prepopulate_id INTEGER DEFAULT 0,created_by_policy INTEGER DEFAULT 0,last_modified INTEGER DEFAULT 0,sync_guid VARCHAR,alternate_urls VARCHAR,image_url VARCHAR,search_url_post_params VARCHAR,suggest_url_post_params VARCHAR,image_url_post_params VARCHAR,new_tab_url VARCHAR,last_visited INTEGER DEFAULT 0, created_from_play_api INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, starter_pack_id INTEGER DEFAULT 0, enforced_by_policy INTEGER DEFAULT 0, featured_by_policy INTEGER DEFAULT 0, url_hash BLOB);
CREATE TABLE local_ibans (guid VARCHAR PRIMARY KEY, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, value_encrypted VARCHAR, nickname VARCHAR);
CREATE TABLE local_stored_cvc (guid VARCHAR PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE loyalty_card_merchant_domain (loyalty_card_id VARCHAR, merchant_domain VARCHAR);
CREATE TABLE loyalty_cards (loyalty_card_id TEXT PRIMARY KEY NOT NULL, merchant_name TEXT NOT NULL, program_name TEXT NOT NULL, program_logo TEXT NOT NULL, loyalty_card_number TEXT NOT NULL);
CREATE TABLE masked_bank_accounts (instrument_id INTEGER PRIMARY KEY NOT NULL, bank_name VARCHAR, account_number_suffix VARCHAR, account_type INTEGER DEFAULT 0, display_icon_url VARCHAR, nickname VARCHAR);
CREATE TABLE masked_bank_accounts_metadata (instrument_id INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE masked_credit_card_benefits (benefit_id VARCHAR PRIMARY KEY NOT NULL, instrument_id INTEGER NOT NULL DEFAULT 0, benefit_type INTEGER NOT NULL DEFAULT 0, benefit_category INTEGER NOT NULL DEFAULT 0, benefit_description VARCHAR NOT NULL, start_time INTEGER, end_time INTEGER);
CREATE TABLE masked_credit_cards (id VARCHAR, name_on_card VARCHAR, network VARCHAR, last_four VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, bank_name VARCHAR, nickname VARCHAR, card_issuer INTEGER DEFAULT 0, instrument_id INTEGER DEFAULT 0, virtual_card_enrollment_state INTEGER DEFAULT 0, card_art_url VARCHAR, product_description VARCHAR, card_issuer_id VARCHAR, virtual_card_enrollment_type INTEGER DEFAULT 0, product_terms_url VARCHAR, card_info_retrieval_enrollment_state INTEGER DEFAULT 0, card_benefit_source INTEGER DEFAULT 0, card_creation_source INTEGER DEFAULT 0);
CREATE TABLE masked_ibans (instrument_id VARCHAR PRIMARY KEY NOT NULL, prefix VARCHAR NOT NULL, suffix VARCHAR NOT NULL, nickname VARCHAR);
CREATE TABLE masked_ibans_metadata (instrument_id VARCHAR PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE offer_data (offer_id UNSIGNED LONG, offer_reward_amount VARCHAR, expiry UNSIGNED LONG, offer_details_url VARCHAR, merchant_domain VARCHAR, promo_code VARCHAR, value_prop_text VARCHAR, see_details_text VARCHAR, usage_instructions_text VARCHAR);
CREATE TABLE offer_eligible_instrument (offer_id UNSIGNED LONG, instrument_id UNSIGNED LONG);
CREATE TABLE offer_merchant_domain (offer_id UNSIGNED LONG, merchant_domain VARCHAR);
CREATE TABLE payment_instrument_creation_options (id VARCHAR PRIMARY KEY NOT NULL, serialized_value_encrypted VARCHAR NOT NULL);
CREATE TABLE payment_method_manifest ( expire_date INTEGER NOT NULL DEFAULT 0, method_name VARCHAR, web_app_id VARCHAR);
CREATE TABLE payments_customer_data (customer_id VARCHAR);
CREATE TABLE plus_address_sync_entity_metadata (model_type INTEGER, storage_key VARCHAR, value BLOB, PRIMARY KEY (model_type, storage_key));
CREATE TABLE plus_address_sync_model_type_state (model_type INTEGER PRIMARY KEY, value BLOB);
CREATE TABLE plus_addresses (profile_id VARCHAR PRIMARY KEY, facet VARCHAR, plus_address VARCHAR);
CREATE TABLE secure_payment_confirmation_browser_bound_key ( credential_id BLOB NOT NULL, relying_party_id TEXT NOT NULL, browser_bound_key_id BLOB, last_used TIMESTAMP, PRIMARY KEY (credential_id, relying_party_id));
CREATE TABLE secure_payment_confirmation_instrument ( credential_id BLOB NOT NULL PRIMARY KEY, relying_party_id VARCHAR NOT NULL, label VARCHAR NOT NULL, icon BLOB NOT NULL, date_created INTEGER NOT NULL DEFAULT 0, user_id BLOB);
CREATE TABLE server_card_cloud_token_data (id VARCHAR, suffix VARCHAR, exp_month INTEGER DEFAULT 0, exp_year INTEGER DEFAULT 0, card_art_url VARCHAR, instrument_token VARCHAR);
CREATE TABLE server_card_metadata (id VARCHAR NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0, billing_address_id VARCHAR);
CREATE TABLE server_stored_cvc (instrument_id INTEGER PRIMARY KEY NOT NULL, value_encrypted VARCHAR NOT NULL, last_updated_timestamp INTEGER NOT NULL);
CREATE TABLE token_service (service VARCHAR PRIMARY KEY NOT NULL,encrypted_token BLOB,binding_key BLOB,mtls_token_binding INTEGER);
CREATE TABLE valuables_metadata (valuable_id TEXT PRIMARY KEY NOT NULL, use_count INTEGER NOT NULL DEFAULT 0, use_date INTEGER NOT NULL DEFAULT 0);
CREATE TABLE virtual_card_usage_data (id VARCHAR PRIMARY KEY, instrument_id INTEGER DEFAULT 0, merchant_domain VARCHAR, last_four VARCHAR);
CREATE TABLE web_app_manifest_section ( expire_date INTEGER NOT NULL DEFAULT 0, id VARCHAR, min_version INTEGER NOT NULL DEFAULT 0, fingerprints BLOB);
CREATE INDEX autofill_name ON autofill(name);
CREATE INDEX autofill_name_value_lower ON autofill(name, value_lower);

==============================================================================
-- Default/declarative_performance_observer.db
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"declarative_performance_observer_policies": 0, "declarative_performance_observer_reports": 0, "meta": 3, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE declarative_performance_observer_policies (origin TEXT PRIMARY KEY NOT NULL, capture_early_failures BOOLEAN NOT NULL);
CREATE TABLE declarative_performance_observer_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_reports_origin ON declarative_performance_observer_reports(origin);

==============================================================================
-- Default/heavy_ad_intervention_opt_out.db
-- meta: {}
-- rows: {"enabled_previews_v1": 1, "previews_v1": 0}
==============================================================================
CREATE TABLE enabled_previews_v1 (type INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(type));
CREATE TABLE previews_v1 (host_name VARCHAR NOT NULL, time INTEGER NOT NULL, opt_out INTEGER NOT NULL, type INTEGER NOT NULL, PRIMARY KEY(host_name, time DESC, opt_out, type));

==============================================================================
-- Default/WebStorage/QuotaManager
-- meta: {"mmap_status": "-1", "version": "11", "last_compatible_version": "11", "IsBucketsBootstrapped": "1", "IsMediaLicenseDatabaseRemoved": "1"}
-- rows: {"buckets": 2, "meta": 5, "sqlite_sequence": 1}
==============================================================================
CREATE TABLE buckets(id INTEGER PRIMARY KEY AUTOINCREMENT, storage_key TEXT NOT NULL, host TEXT NOT NULL, name TEXT NOT NULL, use_count INTEGER NOT NULL, last_accessed INTEGER NOT NULL, last_modified INTEGER NOT NULL, expiration INTEGER NOT NULL, quota INTEGER NOT NULL, persistent INTEGER NOT NULL, durability INTEGER NOT NULL) STRICT;
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX buckets_by_expiration ON buckets(expiration);
CREATE INDEX buckets_by_host ON buckets(host);
CREATE INDEX buckets_by_last_accessed ON buckets(last_accessed);
CREATE INDEX buckets_by_last_modified ON buckets(last_modified);
CREATE UNIQUE INDEX buckets_by_storage_key ON buckets(storage_key, name);

==============================================================================
-- Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/SharedStorage
-- meta: {}
-- rows: {}
==============================================================================
;

==============================================================================
-- Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Trust Tokens
-- meta: {"mmap_status": "-1", "version": "2", "last_compatible_version": "2"}
-- rows: {"meta": 3, "trust_tokens_issuer_config": 0, "trust_tokens_issuer_toplevel_pair_config": 0, "trust_tokens_toplevel_config": 0}
==============================================================================
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE trust_tokens_issuer_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_issuer_toplevel_pair_config ( key TEXT, proto BLOB, PRIMARY KEY(key));
CREATE TABLE trust_tokens_toplevel_config ( key TEXT, proto BLOB, PRIMARY KEY(key));

==============================================================================
-- Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/declarative_performance_observer.db
-- meta: {"mmap_status": "-1", "version": "1", "last_compatible_version": "1"}
-- rows: {"declarative_performance_observer_policies": 0, "declarative_performance_observer_reports": 0, "meta": 3, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE declarative_performance_observer_policies (origin TEXT PRIMARY KEY NOT NULL, capture_early_failures BOOLEAN NOT NULL);
CREATE TABLE declarative_performance_observer_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_reports_origin ON declarative_performance_observer_reports(origin);

==============================================================================
-- Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Shared Dictionary/db
-- meta: {"mmap_status": "-1", "version": "4", "last_compatible_version": "4", "total_dict_size": "0"}
-- rows: {"dictionaries": 0, "meta": 4, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE dictionaries(primary_key INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,frame_origin TEXT NOT NULL,top_frame_site TEXT NOT NULL,host TEXT NOT NULL,match TEXT NOT NULL,match_dest TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,last_fetch_time INTEGER NOT NULL,res_time INTEGER NOT NULL,exp_time INTEGER NOT NULL,last_used_time INTEGER NOT NULL,size INTEGER NOT NULL,sha256 BLOB NOT NULL,token_high INTEGER NOT NULL,token_low INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX exp_time_index ON dictionaries(exp_time);
CREATE INDEX isolation_index ON dictionaries(frame_origin,top_frame_site);
CREATE INDEX last_used_time_index ON dictionaries(last_used_time);
CREATE INDEX token_index ON dictionaries(token_high, token_low);
CREATE INDEX top_frame_site_index ON dictionaries(top_frame_site);
CREATE UNIQUE INDEX unique_index ON dictionaries(frame_origin,top_frame_site,host,match,match_dest);

==============================================================================
-- Default/Shared Dictionary/db
-- meta: {"mmap_status": "-1", "version": "4", "last_compatible_version": "4", "total_dict_size": "0"}
-- rows: {"dictionaries": 0, "meta": 4, "sqlite_sequence": 0}
==============================================================================
CREATE TABLE dictionaries(primary_key INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,frame_origin TEXT NOT NULL,top_frame_site TEXT NOT NULL,host TEXT NOT NULL,match TEXT NOT NULL,match_dest TEXT NOT NULL,id TEXT NOT NULL,url TEXT NOT NULL,last_fetch_time INTEGER NOT NULL,res_time INTEGER NOT NULL,exp_time INTEGER NOT NULL,last_used_time INTEGER NOT NULL,size INTEGER NOT NULL,sha256 BLOB NOT NULL,token_high INTEGER NOT NULL,token_low INTEGER NOT NULL);
CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX exp_time_index ON dictionaries(exp_time);
CREATE INDEX isolation_index ON dictionaries(frame_origin,top_frame_site);
CREATE INDEX last_used_time_index ON dictionaries(last_used_time);
CREATE INDEX token_index ON dictionaries(token_high, token_low);
CREATE INDEX top_frame_site_index ON dictionaries(top_frame_site);
CREATE UNIQUE INDEX unique_index ON dictionaries(frame_origin,top_frame_site,host,match,match_dest);

==============================================================================
-- segmentation_platform/ukm_db
-- meta: {}
-- rows: {"metrics": 3, "uma_metrics": 7, "urls": 8}
==============================================================================
CREATE TABLE metrics(id INTEGER PRIMARY KEY NOT NULL,event_timestamp INTEGER NOT NULL,ukm_source_id INTEGER NOT NULL,url_id INTEGER NOT NULL,event_id INTEGER NOT NULL,event_hash TEXT NOT NULL,metric_hash TEXT NOT NULL,metric_value INTEGER NOT NULL);
CREATE TABLE uma_metrics(id INTEGER PRIMARY KEY NOT NULL,event_timestamp INTEGER NOT NULL,profile_id INTEGER NOT NULL,type INTEGER NOT NULL,metric_hash TEXT NOT NULL,metric_value INTEGER NOT NULL);
CREATE TABLE urls(url_id INTEGER PRIMARY KEY NOT NULL,url TEXT NOT NULL,last_timestamp INTEGER NOT NULL,counter INTEGER,title TEXT,profile_id TEXT);
CREATE INDEX event_hash_index ON metrics(event_hash);
CREATE INDEX event_timestamp_index ON metrics(event_timestamp);
CREATE INDEX ukm_source_id_index ON metrics(ukm_source_id);
CREATE INDEX uma_event_timestamp_index ON uma_metrics(event_timestamp);
CREATE INDEX uma_metric_hash_index ON uma_metrics(metric_hash);
CREATE INDEX uma_profile_id_index ON uma_metrics(profile_id);
CREATE INDEX uma_type_index ON uma_metrics(type);
CREATE INDEX url_id_index ON metrics(url_id);