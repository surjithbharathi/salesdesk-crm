<?php
/**
 * Plugin Name: Salesdesk enquiries
 * Description: Sends each Contact Form 7 enquiry to Devi Industries' Salesdesk CRM as a lead. An enquiry the CRM does not take at once is tried again every 15 minutes for a day.
 * Version: 1.0.0
 * Author: Devi Industries
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SALESDESK_ENQUIRY_URL', 'https://crm.example.com/hooks/website/__TOKEN__' );

/** Posts one enquiry to the CRM. True when the CRM answered 200. */
function salesdesk_enquiry_send( $body ) {
	$response = wp_remote_post(
		SALESDESK_ENQUIRY_URL,
		array(
			'timeout' => 8,
			'headers' => array( 'Content-Type' => 'application/json' ),
			'body'    => wp_json_encode( $body ),
		)
	);
	return ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response );
}

/** Keeps an enquiry the CRM did not take, to try again later (at most 200 kept, each for a day). */
function salesdesk_enquiry_keep( $body ) {
	$queue   = get_option( 'salesdesk_enquiry_queue', array() );
	$queue   = is_array( $queue ) ? $queue : array();
	$queue[] = array( 'body' => $body, 'since' => time() );
	update_option( 'salesdesk_enquiry_queue', array_slice( $queue, -200 ), false );
	if ( ! wp_next_scheduled( 'salesdesk_enquiry_retry' ) ) {
		wp_schedule_single_event( time() + 900, 'salesdesk_enquiry_retry' );
	}
}

add_action(
	'wpcf7_mail_sent',
	function ( $form ) {
		if ( ! class_exists( 'WPCF7_Submission' ) ) {
			return;
		}
		$submission = WPCF7_Submission::get_instance();
		if ( ! $submission ) {
			return;
		}
		$data  = (array) $submission->get_posted_data();
		$field = function ( $key ) use ( $data ) {
			$value = isset( $data[ $key ] ) ? $data[ $key ] : '';
			if ( is_array( $value ) ) {
				$value = implode( ', ', $value );
			}
			return sanitize_textarea_field( (string) $value );
		};
		$at   = (int) $submission->get_meta( 'timestamp' );
		$body = array(
			'id'       => 'cf7-' . $form->id() . '-' . md5( $field( 'your-phone' ) . '|' . $field( 'your-email' ) . '|' . $at . '|' . $field( 'your-message' ) ),
			'form'     => $form->title(),
			'name'     => $field( 'your-name' ),
			'phone'    => $field( 'your-phone' ),
			'email'    => $field( 'your-email' ),
			'location' => $field( 'your-location' ),
			'machine'  => $field( 'machine' ),
			'language' => $field( 'language' ),
			'message'  => $field( 'your-message' ),
			'page'     => (string) $submission->get_meta( 'url' ),
			'at'       => $at ? $at : time(),
		);
		if ( ! salesdesk_enquiry_send( $body ) ) {
			salesdesk_enquiry_keep( $body );
		}
	}
);

add_action(
	'salesdesk_enquiry_retry',
	function () {
		$queue = get_option( 'salesdesk_enquiry_queue', array() );
		$left  = array();
		foreach ( is_array( $queue ) ? $queue : array() as $item ) {
			if ( ! is_array( $item ) || empty( $item['body'] ) || time() - (int) $item['since'] > DAY_IN_SECONDS ) {
				continue;
			}
			if ( ! salesdesk_enquiry_send( $item['body'] ) ) {
				$left[] = $item;
			}
		}
		update_option( 'salesdesk_enquiry_queue', $left, false );
		if ( $left && ! wp_next_scheduled( 'salesdesk_enquiry_retry' ) ) {
			wp_schedule_single_event( time() + 900, 'salesdesk_enquiry_retry' );
		}
	}
);
