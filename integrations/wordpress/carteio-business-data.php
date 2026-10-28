<?php
/**
 * Plugin Name: Carteio Business Data API
 * Description: Exposes published WordPress pages and WooCommerce product data through the Carteio Business API v1 contract.
 * Version: 1.0.0
 * Requires PHP: 8.0
 */
if (!defined('ABSPATH')) { exit; }

final class Carteio_Business_Data_API {
    private const OPTION = 'carteio_business_data_api_token';
    private const DELETED = 'carteio_business_data_deleted_ids';
    private const PAGE_SIZE = 100;

    public function __construct() {
        add_action('rest_api_init', [$this, 'routes']);
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_post_carteio_rotate_token', [$this, 'rotate_token']);
        add_action('before_delete_post', [$this, 'record_deleted']);
        add_action('transition_post_status', [$this, 'record_status_transition'], 10, 3);
    }
    public function menu(): void { add_options_page('Carteio Business Data', 'Carteio Business Data', 'manage_options', 'carteio-business-data', [$this, 'settings']); }
    public function settings(): void {
        if (!current_user_can('manage_options')) { return; }
        echo '<div class="wrap"><h1>Carteio Business Data API</h1><p>Generate a bearer token for a Carteio connector. Copy it once into the encrypted connector credential form.</p>';
        $new_token = get_transient('carteio_business_data_new_token_' . get_current_user_id());
        if (is_string($new_token) && $new_token !== '') { delete_transient('carteio_business_data_new_token_' . get_current_user_id()); echo '<div class="notice notice-warning"><p>Copy this token now. It will not be shown again: <code>' . esc_html($new_token) . '</code></p></div>'; }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('carteio_rotate_token');
        echo '<input type="hidden" name="action" value="carteio_rotate_token"><button class="button button-primary">Generate new API token</button></form>';
        echo '<p>Token is never displayed after generation. Rotating it immediately revokes the previous token.</p></div>';
    }
    public function rotate_token(): void {
        if (!current_user_can('manage_options')) { wp_die('Forbidden', 403); }
        check_admin_referer('carteio_rotate_token');
        $token = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        update_option(self::OPTION, hash('sha256', $token), false);
        set_transient('carteio_business_data_new_token_' . get_current_user_id(), $token, 60);
        wp_safe_redirect(add_query_arg('carteio_token_generated', '1', admin_url('options-general.php?page=carteio-business-data')));
        exit;
    }
    public function routes(): void {
        register_rest_route('carteio/v1', '/products', ['methods' => 'GET', 'permission_callback' => [$this, 'authorized'], 'callback' => [$this, 'products']]);
        register_rest_route('carteio/v1', '/content', ['methods' => 'GET', 'permission_callback' => [$this, 'authorized'], 'callback' => [$this, 'content']]);
    }
    public function authorized(WP_REST_Request $request): bool {
        $header = (string) $request->get_header('authorization');
        if (!preg_match('/^Bearer\s+([A-Za-z0-9_-]{40,100})$/', $header, $match)) { return false; }
        $stored = (string) get_option(self::OPTION, '');
        return $stored !== '' && hash_equals($stored, hash('sha256', $match[1]));
    }
    private function page_args(WP_REST_Request $request, string $resource): array {
        $cursor = max(1, min(1000000, (int) $request->get_param('cursor')));
        $deleted = array_filter((array) get_option(self::DELETED, []), static fn($row) => ($row['resource'] ?? '') === $resource);
        $limit = max(1, min(self::PAGE_SIZE - min(99, count($deleted)), (int) ($request->get_param('limit') ?: self::PAGE_SIZE)));
        return [$cursor, $limit, sanitize_text_field((string) $request->get_param('updatedAfter'))];
    }
    private function response(array $items, int $page, int $totalPages, string $resource): WP_REST_Response {
        $deleted = get_option(self::DELETED, []);
        $deletedIds = array_values(array_slice(array_filter((array) $deleted, static fn($row) => ($row['resource'] ?? '') === $resource), 0, 99));
        return new WP_REST_Response(['contractVersion' => '1.0', 'items' => $items, 'nextCursor' => $page < $totalPages ? (string) ($page + 1) : null, 'complete' => $page >= $totalPages, 'updatedThrough' => gmdate('c'), 'deletedIds' => array_column($deletedIds, 'id')], 200);
    }
    public function products(WP_REST_Request $request): WP_REST_Response {
        if (!class_exists('WooCommerce')) { return new WP_REST_Response(['contractVersion' => '1.0', 'items' => [], 'nextCursor' => null, 'complete' => true, 'updatedThrough' => gmdate('c'), 'deletedIds' => []], 200); }
        [$page, $limit, $updatedAfter] = $this->page_args($request, 'PRODUCTS');
        $args = ['post_type' => 'product', 'post_status' => 'publish', 'posts_per_page' => $limit, 'paged' => $page, 'orderby' => 'modified', 'order' => 'ASC', 'no_found_rows' => false];
        if ($updatedAfter && strtotime($updatedAfter)) { $args['date_query'] = [['column' => 'post_modified_gmt', 'after' => gmdate('Y-m-d H:i:s', strtotime($updatedAfter)), 'inclusive' => true]]; }
        $query = new WP_Query($args); $items = [];
        foreach ($query->posts as $post) {
            $product = wc_get_product($post->ID); if (!$product || !$product->is_visible()) { continue; }
            $variants = [];
            if ($product->is_type('variable')) {
                foreach (array_slice($product->get_children(), 0, 1000) as $variant_id) {
                    $variant = wc_get_product($variant_id); if (!$variant) { continue; }
                    $variants[] = ['id' => (string) $variant->get_id(), 'title' => (string) $variant->get_name(), 'sku' => $variant->get_sku() ?: null, 'currency' => get_woocommerce_currency(), 'price' => $variant->get_price() !== '' ? (string) $variant->get_price() : null, 'inventory' => $variant->managing_stock() ? $variant->get_stock_quantity() : null, 'availability' => $variant->is_in_stock() ? 'IN_STOCK' : 'OUT_OF_STOCK', 'status' => $variant->get_status()];
                }
            } else {
                $variants[] = ['id' => (string) $product->get_id(), 'title' => (string) $product->get_name(), 'sku' => $product->get_sku() ?: null, 'currency' => get_woocommerce_currency(), 'price' => $product->get_price() !== '' ? (string) $product->get_price() : null, 'inventory' => $product->managing_stock() ? $product->get_stock_quantity() : null, 'availability' => $product->is_in_stock() ? 'IN_STOCK' : 'OUT_OF_STOCK', 'status' => $product->get_status()];
            }
            $terms = get_the_terms($post->ID, 'product_cat');
            $items[] = ['id' => (string) $product->get_id(), 'name' => (string) $product->get_name(), 'description' => mb_substr(wp_strip_all_tags($product->get_description()), 0, 7000), 'sku' => $product->get_sku() ?: null, 'category' => $terms && !is_wp_error($terms) ? implode(', ', wp_list_pluck($terms, 'name')) : null, 'currency' => get_woocommerce_currency(), 'price' => $product->get_price() !== '' ? (string) $product->get_price() : null, 'inventory' => $product->managing_stock() ? $product->get_stock_quantity() : null, 'availability' => $product->is_in_stock() ? 'IN_STOCK' : 'OUT_OF_STOCK', 'status' => $product->get_status(), 'url' => get_permalink($product->get_id()), 'imageUrl' => wp_get_attachment_url($product->get_image_id()) ?: null, 'updatedAt' => gmdate('c', strtotime($post->post_modified_gmt)), 'variants' => $variants, 'variantsComplete' => true];
        }
        return $this->response($items, $page, max(1, (int) $query->max_num_pages), 'PRODUCTS');
    }
    public function content(WP_REST_Request $request): WP_REST_Response {
        [$page, $limit, $updatedAfter] = $this->page_args($request, 'CONTENT');
        $types = (array) apply_filters('carteio_business_data_post_types', ['page', 'post']);
        $types = array_values(array_filter($types, static fn($type) => is_string($type) && !in_array($type, ['attachment', 'product', 'shop_order', 'shop_order_refund'], true) && get_post_type_object($type)?->public));
        $args = ['post_type' => $types ?: ['page', 'post'], 'post_status' => 'publish', 'has_password' => false, 'posts_per_page' => $limit, 'paged' => $page, 'orderby' => 'modified', 'order' => 'ASC', 'no_found_rows' => false];
        if ($updatedAfter && strtotime($updatedAfter)) { $args['date_query'] = [['column' => 'post_modified_gmt', 'after' => gmdate('Y-m-d H:i:s', strtotime($updatedAfter)), 'inclusive' => true]]; }
        $query = new WP_Query($args); $items = [];
        foreach ($query->posts as $post) {
            if ($post->post_password !== '') { continue; }
            $url = get_permalink($post); $path = strtolower((string) wp_parse_url($url, PHP_URL_PATH));
            if (preg_match('~/(?:account|my-account|checkout|cart|login|logout|members?|orders?)(?:/|$)~', $path)) { continue; }
            $slug = strtolower((string) $post->post_name);
            $category = $post->post_type === 'post' ? 'article' : 'website-page';
            foreach (['faq', 'privacy-policy', 'shipping-policy', 'refund-policy', 'return-policy', 'terms', 'about', 'contact', 'service'] as $topic) { if (str_contains($slug, $topic)) { $category = $topic; break; } }
            $items[] = ['id' => $post->post_type . ':' . $post->ID, 'title' => get_the_title($post), 'content' => mb_substr(wp_strip_all_tags(strip_shortcodes($post->post_content)), 0, 7000), 'category' => $category, 'url' => $url, 'language' => get_bloginfo('language') ?: null, 'updatedAt' => gmdate('c', strtotime($post->post_modified_gmt))];
        }
        return $this->response($items, $page, max(1, (int) $query->max_num_pages), 'CONTENT');
    }
    public function record_deleted(int $post_id): void {
        $type = get_post_type($post_id); if (!in_array($type, ['product', 'page', 'post'], true)) { return; }
        $this->remember_tombstone($type, $post_id);
    }
    public function record_status_transition(string $new_status, string $old_status, WP_Post $post): void {
        if (!in_array($post->post_type, ['product', 'page', 'post'], true)) { return; }
        if ($old_status === 'publish' && $new_status !== 'publish') { $this->remember_tombstone($post->post_type, (int) $post->ID); }
        if ($new_status === 'publish') {
            $resource = $post->post_type === 'product' ? 'PRODUCTS' : 'CONTENT';
            $id = $post->post_type === 'product' ? (string) $post->ID : $post->post_type . ':' . $post->ID;
            $rows = array_values(array_filter((array) get_option(self::DELETED, []), static fn($row) => !(($row['resource'] ?? '') === $resource && ($row['id'] ?? '') === $id)));
            update_option(self::DELETED, $rows, false);
        }
    }
    private function remember_tombstone(string $type, int $post_id): void {
        $resource = $type === 'product' ? 'PRODUCTS' : 'CONTENT'; $id = $type === 'product' ? (string) $post_id : $type . ':' . $post_id;
        $rows = (array) get_option(self::DELETED, []);
        $rows = array_values(array_filter($rows, static fn($row) => !(($row['resource'] ?? '') === $resource && ($row['id'] ?? '') === $id)));
        $rows[] = ['resource' => $resource, 'id' => $id];
        update_option(self::DELETED, array_slice($rows, -500), false);
    }
}
new Carteio_Business_Data_API();
