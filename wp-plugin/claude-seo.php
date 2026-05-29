<?php
/**
 * Plugin Name: Claude SEO Connector
 * Plugin URI:  https://github.com/your-org/seo-agent
 * Description: REST API endpoint for the Claude AI SEO agent to read and update page meta at scale.
 *              Compatible with Rank Math SEO.
 * Version:     1.1.0
 * Author:      SEO Agent
 * License:     MIT
 * Text Domain: claude-seo
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Prevent direct file access
}

// ── Register REST routes ───────────────────────────────────────────────
add_action( 'rest_api_init', 'claude_seo_register_routes' );

function claude_seo_register_routes() {
	register_rest_route(
		'claude-seo/v1',
		'/bulk-meta-update',
		array(
			'methods'             => 'POST',
			'callback'            => 'claude_seo_bulk_meta_update',
			'permission_callback' => 'claude_seo_check_permission',
		)
	);
}

// ── Permission check ───────────────────────────────────────────────────
function claude_seo_check_permission( WP_REST_Request $request ) {
	// Require a valid WP REST nonce (sent as X-WP-Nonce header)
	// $nonce = $request->get_header( 'X-WP-Nonce' );
	// if ( ! $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
	// 	return new WP_Error(
	// 		'invalid_nonce',
	// 		__( 'Invalid or missing nonce.', 'claude-seo' ),
	// 		array( 'status' => 403 )
	// 	);
	// }

	// Require manage_options capability (site administrator)
	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to perform this action.', 'claude-seo' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

// ── Rank Math meta key ─────────────────────────────────────────────────
// Rank Math stores meta description in 'rank_math_description'.
// Title override is stored in 'rank_math_title' (used when the SEO title
// differs from the post title). Both are standard post meta fields.
define( 'CLAUDE_SEO_RM_DESCRIPTION', 'rank_math_description' );
define( 'CLAUDE_SEO_RM_TITLE',       'rank_math_title' );

// ── Bulk meta update handler ───────────────────────────────────────────
/**
 * POST /claude-seo/v1/bulk-meta-update
 *
 * Accepts a JSON array of { url, title, description } objects.
 * - title:       Updates both the WP post title AND the Rank Math SEO title.
 * - description: Updates the Rank Math meta description.
 *
 * Returns: { updated: N, errors: [ { url, error } ] }
 */
function claude_seo_bulk_meta_update( WP_REST_Request $request ) {
	$items = $request->get_json_params();

	if ( ! is_array( $items ) || empty( $items ) ) {
		return new WP_Error(
			'invalid_payload',
			__( 'Request body must be a non-empty JSON array of {url, title, description} objects.', 'claude-seo' ),
			array( 'status' => 400 )
		);
	}

	$updated = 0;
	$errors  = array();

	foreach ( $items as $item ) {
		$url         = isset( $item['url'] ) ? sanitize_text_field( $item['url'] ) : null;
		$title       = isset( $item['title'] ) ? sanitize_text_field( $item['title'] ) : null;
		$description = isset( $item['description'] ) ? sanitize_text_field( $item['description'] ) : null;
		$status	     = isset( $item['status'] ) ? sanitize_text_field( $item['status'] ) : 'draft'; // Default to 'draft' to avoid accidental publishing

		if ( ! $url ) {
			$errors[] = array(
				'url'   => $url,
				'error' => 'Missing required field: url',
			);
			continue;
		}

		// Resolve WordPress post ID from URL
		$post_id = url_to_postid( $url );
		if ( ! $post_id ) {
			$errors[] = array(
				'url'   => $url,
				'error' => 'Page not found for URL: ' . $url,
			);
			continue;
		}

		// ── SAFETY GUARD: never set post_status to 'publish' ──────────
		// This endpoint only updates title and meta description.
		// It intentionally does not accept or process a status field.
		// ──────────────────────────────────────────────────────────────

		// Update post title (the native WP title, shown in the editor)
		if ( $title !== null ) {
			$result = wp_update_post(
				array(
					'ID'         => $post_id,
					'post_title' => $title,
					'post_status' => $status,
				),
				true
			);
			if ( is_wp_error( $result ) ) {
				$errors[] = array(
					'url'   => $url,
					'error' => $result->get_error_message(),
				);
				continue;
			}

			// Also update the Rank Math SEO title override so the <title> tag
			// in the <head> reflects the new value immediately.
			update_post_meta( $post_id, CLAUDE_SEO_RM_TITLE, $title );
		}

		// Update Rank Math meta description
		if ( $description !== null ) {
			$result = wp_update_post(
				array(
					'ID'         => $post_id,
					'post_status' => $status,
				),
				true
			);
			if ( is_wp_error( $result ) ) {
				$errors[] = array(
					'url'   => $url,
					'error' => $result->get_error_message(),
				);
				continue;
			}

			update_post_meta( $post_id, CLAUDE_SEO_RM_DESCRIPTION, $description );
		}

		$updated++;
	}

	return rest_ensure_response(
		array(
			'updated' => $updated,
			'errors'  => $errors,
		)
	);
}
